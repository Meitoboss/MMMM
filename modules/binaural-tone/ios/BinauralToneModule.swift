import AVFoundation
import ExpoModulesCore

/// The binaural tone on the phone, in a stream that never ends (iOS). The same math as the Kotlin file.
public class BinauralToneModule: Module {
  /// what the audio thread should move towards; written from the JS side, under `lock`
  private struct Targets {
    var freqL = 200.0, freqR = 200.0
    var tone: Float = 0
    var noise: Float = 0
    var master: Float = 0
  }

  private let lock = NSLock()
  private var targets = Targets()
  private var engine: AVAudioEngine?
  private var source: AVAudioSourceNode?
  private var sampleRate = 48_000.0
  private var routeObserver: NSObjectProtocol?
  private var configObserver: NSObjectProtocol?
  private var lastHeadphones: Bool?

  // only the audio thread uses these
  private var phaseL = 0.0, phaseR = 0.0
  private var freqL = 200.0, freqR = 200.0
  private var tone: Float = 0, noise: Float = 0, master: Float = 0
  private var pink = [Float](repeating: 0, count: 7)

  public func definition() -> ModuleDefinition {
    Name("BinauralTone")
    Events("onOutputChange")

    Function("start") { (center: Double, beat: Double, tone: Double, noise: Double) throws in
      self.setTargets(center: center, beat: beat, tone: tone, noise: noise, master: 1)
      try self.startEngine()
    }
    Function("update") { (center: Double, beat: Double, tone: Double, noise: Double) in
      self.setTargets(center: center, beat: beat, tone: tone, noise: noise, master: nil)
    }
    Function("stop") {
      self.setTargets(master: 0)
      // after the one-second fade-out the engine is stopped and released
      DispatchQueue.main.asyncAfter(deadline: .now() + 1.3) { [weak self] in
        guard let self else { return }
        self.lock.lock()
        let silent = self.targets.master == 0
        self.lock.unlock()
        if silent { self.releaseEngine() }
      }
    }
    Function("headphones") { () -> Bool in
      BinauralToneModule.headphonesConnected()
    }

    OnCreate {
      self.routeObserver = NotificationCenter.default.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] _ in
        self?.reportOutput()
      }
    }
    OnDestroy {
      if let observer = self.routeObserver { NotificationCenter.default.removeObserver(observer) }
      self.releaseEngine()
    }
  }

  private func setTargets(center: Double, beat: Double, tone: Double, noise: Double, master: Float?) {
    lock.lock()
    targets.freqL = max(1, center - beat / 2)
    targets.freqR = max(1, center + beat / 2)
    targets.tone = Float(tone)
    targets.noise = Float(noise)
    if let master { targets.master = master }
    lock.unlock()
  }

  private func setTargets(master: Float) {
    lock.lock()
    targets.master = master
    lock.unlock()
  }

  private func startEngine() throws {
    // mixes with the music player, and keeps playing in the background like the music does
    // (errors are passed on to the app, so a silent tone shows its reason instead of nothing)
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
    try session.setActive(true)
    if engine == nil { makeEngine() }
    if let engine, !engine.isRunning { try engine.start() }
    if engine?.isRunning != true { throw NSError(domain: "BinauralTone", code: 1, userInfo: [NSLocalizedDescriptionKey: "the audio engine did not start"]) }
  }

  private func makeEngine() {
    let engine = AVAudioEngine()
    sampleRate = engine.outputNode.outputFormat(forBus: 0).sampleRate
    let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 2)!
    let node = AVAudioSourceNode(format: format) { [weak self] _, _, frameCount, bufferList in
      guard let self else { return noErr }
      let buffers = UnsafeMutableAudioBufferListPointer(bufferList)
      guard let left = buffers[0].mData?.assumingMemoryBound(to: Float.self),
            let right = buffers[1].mData?.assumingMemoryBound(to: Float.self) else { return noErr }
      self.render(left: left, right: right, frames: Int(frameCount))
      return noErr
    }
    engine.attach(node)
    engine.connect(node, to: engine.mainMixerNode, format: format)
    self.engine = engine
    self.source = node
    // iOS stops the engine by itself when the audio session changes (the music player does this): start it again
    configObserver = NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main) { [weak self] _ in
      guard let self, let engine = self.engine else { return }
      self.lock.lock()
      let wanted = self.targets.master > 0
      self.lock.unlock()
      if wanted && !engine.isRunning { try? engine.start() }
    }
  }

  private func releaseEngine() {
    guard let engine else { return }
    engine.stop()
    if let source { engine.detach(source) }
    if let configObserver { NotificationCenter.default.removeObserver(configObserver) }
    configObserver = nil
    self.source = nil
    self.engine = nil
  }

  /// Fills one buffer. Pitch, loudness and noise glide (time constant 0.15 s); the master fades linearly over 1 s.
  private func render(left: UnsafeMutablePointer<Float>, right: UnsafeMutablePointer<Float>, frames: Int) {
    lock.lock()
    let t = targets
    lock.unlock()

    let twoPi = 2.0 * Double.pi
    let glide = 1.0 - exp(-1.0 / (0.15 * sampleRate))
    let g = Float(glide)
    let fadeStep = Float(1.0 / sampleRate)
    for i in 0..<frames {
      freqL += (t.freqL - freqL) * glide
      freqR += (t.freqR - freqR) * glide
      tone += (t.tone - tone) * g
      noise += (t.noise - noise) * g
      if master < t.master { master = min(t.master, master + fadeStep) }
      if master > t.master { master = max(t.master, master - fadeStep) }

      phaseL += twoPi * freqL / sampleRate
      phaseR += twoPi * freqR / sampleRate
      if phaseL > twoPi { phaseL -= twoPi }
      if phaseR > twoPi { phaseR -= twoPi }

      // pink noise (Paul Kellet's filter), the same in both ears
      let white = Float.random(in: -1...1)
      pink[0] = 0.99886 * pink[0] + white * 0.0555179
      pink[1] = 0.99332 * pink[1] + white * 0.0750759
      pink[2] = 0.96900 * pink[2] + white * 0.1538520
      pink[3] = 0.86650 * pink[3] + white * 0.3104856
      pink[4] = 0.55000 * pink[4] + white * 0.5329522
      pink[5] = -0.7616 * pink[5] - white * 0.0168980
      let pinkSample = (pink[0] + pink[1] + pink[2] + pink[3] + pink[4] + pink[5] + pink[6] + white * 0.5362) * 0.11
      pink[6] = white * 0.115926
      let n = pinkSample * noise

      left[i] = (Float(sin(phaseL)) * tone + n) * master
      right[i] = (Float(sin(phaseR)) * tone + n) * master
    }
  }

  private func reportOutput() {
    let headphones = BinauralToneModule.headphonesConnected()
    guard headphones != lastHeadphones else { return }
    lastHeadphones = headphones
    sendEvent("onOutputChange", ["headphones": headphones])
  }

  static func headphonesConnected() -> Bool {
    let phones: [AVAudioSession.Port] = [.headphones, .bluetoothA2DP, .bluetoothHFP, .bluetoothLE, .usbAudio, .lineOut]
    return AVAudioSession.sharedInstance().currentRoute.outputs.contains { phones.contains($0.portType) }
  }
}
