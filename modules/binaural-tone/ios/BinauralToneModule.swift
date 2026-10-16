import AVFoundation
import ExpoModulesCore

/// Makes the sine tone on the phone, in a stream that never ends (iOS). The math is the same as on Android (see the Kotlin file).
public class BinauralToneModule: Module {
  private var engine: AVAudioEngine?
  private var source: AVAudioSourceNode?
  private let lock = NSLock()

  // values the audio thread reads (guarded by `lock`)
  private var targetFreqL = 200.0, targetFreqR = 200.0
  private var targetGain: Float = 0
  private var sampleRate = 48_000.0

  // audio-thread state
  private var phaseL = 0.0, phaseR = 0.0
  private var freqL = 200.0, freqR = 200.0
  private var gain: Float = 0

  public func definition() -> ModuleDefinition {
    Name("BinauralTone")

    Function("start") { (baseHz: Double, beatHz: Double, volume: Double) in
      self.start(baseHz: baseHz, beatHz: beatHz, volume: Float(volume))
    }
    Function("setVolume") { (volume: Double) in
      self.setTarget(gain: Float(volume))
    }
    Function("stop") {
      self.stop()
    }
  }

  private func start(baseHz: Double, beatHz: Double, volume: Float) {
    // mix with the music player, and keep playing in the background like the music does
    try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [.mixWithOthers])
    try? AVAudioSession.sharedInstance().setActive(true)

    if engine == nil { makeEngine() }
    lock.lock()
    targetFreqL = max(1, baseHz - beatHz / 2)
    targetFreqR = max(1, baseHz + beatHz / 2)
    targetGain = volume
    lock.unlock()
    if let engine, !engine.isRunning { try? engine.start() }
  }

  private func setTarget(gain: Float) {
    lock.lock()
    targetGain = gain
    lock.unlock()
  }

  private func stop() {
    setTarget(gain: 0)
    // the fade out takes a moment; then the engine stops so the phone can rest
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [weak self] in
      guard let self else { return }
      self.lock.lock()
      let silent = self.targetGain == 0
      self.lock.unlock()
      if silent { self.engine?.pause() }
    }
  }

  private func makeEngine() {
    let engine = AVAudioEngine()
    let format = AVAudioFormat(standardFormatWithSampleRate: engine.outputNode.outputFormat(forBus: 0).sampleRate, channels: 2)!
    sampleRate = format.sampleRate
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

    // when the music player changes the audio session, iOS stops the engine by itself: start it again while the tone should play
    NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main) { [weak self] _ in
      self?.restartIfWanted()
    }
  }

  private func restartIfWanted() {
    guard let engine else { return }
    lock.lock()
    let wanted = targetGain > 0
    lock.unlock()
    guard wanted else { return }
    try? AVAudioSession.sharedInstance().setActive(true)
    if !engine.isRunning { try? engine.start() }
  }

  /// Fills one buffer. Frequency and loudness move smoothly to their targets, so a change never clicks.
  private func render(left: UnsafeMutablePointer<Float>, right: UnsafeMutablePointer<Float>, frames: Int) {
    lock.lock()
    let tL = targetFreqL, tR = targetFreqR, tG = targetGain
    lock.unlock()

    let twoPi = 2.0 * Double.pi
    let glide = 1.0 - exp(-1.0 / (0.15 * sampleRate))
    let fadeGain = Float(glide)
    for i in 0..<frames {
      freqL += (tL - freqL) * glide
      freqR += (tR - freqR) * glide
      gain += (tG - gain) * fadeGain

      phaseL += twoPi * freqL / sampleRate
      phaseR += twoPi * freqR / sampleRate
      if phaseL > twoPi { phaseL -= twoPi }
      if phaseR > twoPi { phaseR -= twoPi }

      left[i] = Float(sin(phaseL)) * gain
      right[i] = Float(sin(phaseR)) * gain
    }
  }
}
