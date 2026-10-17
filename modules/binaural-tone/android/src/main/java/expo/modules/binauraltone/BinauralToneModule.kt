package expo.modules.binauraltone

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.random.Random

/** The binaural tone on the phone, in a stream that never ends (Android). The same math as the Swift file. */
class BinauralToneModule : Module() {
  private val rate = 48_000

  // written by the JS side, read by the audio thread
  @Volatile private var targetFreqL = 200.0
  @Volatile private var targetFreqR = 200.0
  @Volatile private var targetTone = 0.0
  @Volatile private var targetNoise = 0.0
  @Volatile private var targetMaster = 0.0

  @Volatile private var thread: Thread? = null
  private var routeCallback: AudioDeviceCallback? = null
  private var lastHeadphones: Boolean? = null

  override fun definition() = ModuleDefinition {
    Name("BinauralTone")
    Events("onOutputChange")

    Function("start") { center: Double, beat: Double, tone: Double, noise: Double ->
      setTargets(center, beat, tone, noise)
      targetMaster = 1.0
      startThread()
    }
    Function("update") { center: Double, beat: Double, tone: Double, noise: Double ->
      setTargets(center, beat, tone, noise)
    }
    // the thread fades out over about one second, then stops and releases the audio track
    Function("stop") {
      targetMaster = 0.0
    }
    Function("headphones") {
      headphonesConnected()
    }

    OnCreate {
      val audio = appContext.reactContext?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
      if (audio != null) {
        val callback = object : AudioDeviceCallback() {
          override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>?) = reportOutput()
          override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>?) = reportOutput()
        }
        audio.registerAudioDeviceCallback(callback, Handler(Looper.getMainLooper()))
        routeCallback = callback
      }
    }
    OnDestroy {
      val audio = appContext.reactContext?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
      routeCallback?.let { audio?.unregisterAudioDeviceCallback(it) }
      targetMaster = 0.0
    }
  }

  private fun setTargets(center: Double, beat: Double, tone: Double, noise: Double) {
    targetFreqL = max(1.0, center - beat / 2)
    targetFreqR = max(1.0, center + beat / 2)
    targetTone = tone
    targetNoise = noise
  }

  private fun startThread() {
    // a thread that is still fading out picks up the new targets, so it is not started twice
    if (thread != null) return
    val minSize = AudioTrack.getMinBufferSize(rate, AudioFormat.CHANNEL_OUT_STEREO, AudioFormat.ENCODING_PCM_FLOAT)
    val track = AudioTrack.Builder()
      .setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_MEDIA)
          .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
          .build(),
      )
      .setAudioFormat(
        AudioFormat.Builder()
          .setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
          .setSampleRate(rate)
          .setChannelMask(AudioFormat.CHANNEL_OUT_STEREO)
          .build(),
      )
      .setBufferSizeInBytes(minSize * 2)
      .setTransferMode(AudioTrack.MODE_STREAM)
      .build()
    track.play()
    thread = Thread { renderLoop(track) }.apply {
      priority = Thread.MAX_PRIORITY
      isDaemon = true
      start()
    }
  }

  /** Writes the tone in small blocks until it has faded out. Pitch, loudness and noise glide (time constant 0.15 s); the master fades linearly over 1 s. */
  private fun renderLoop(audio: AudioTrack) {
    val block = 1024
    val buf = FloatArray(block * 2)
    val twoPi = 2.0 * PI
    val glide = 1.0 - exp(-1.0 / (0.15 * rate))
    val fadeStep = 1.0 / rate
    var freqL = targetFreqL
    var freqR = targetFreqR
    var tone = 0.0
    var noise = 0.0
    var master = 0.0
    var phaseL = 0.0
    var phaseR = 0.0
    val pink = DoubleArray(7)
    try {
      while (true) {
        for (i in 0 until block) {
          freqL += (targetFreqL - freqL) * glide
          freqR += (targetFreqR - freqR) * glide
          tone += (targetTone - tone) * glide
          noise += (targetNoise - noise) * glide
          val goal = targetMaster
          master = if (master < goal) min(goal, master + fadeStep) else max(goal, master - fadeStep)

          phaseL += twoPi * freqL / rate
          phaseR += twoPi * freqR / rate
          if (phaseL > twoPi) phaseL -= twoPi
          if (phaseR > twoPi) phaseR -= twoPi

          // pink noise (Paul Kellet's filter), the same in both ears
          val white = Random.nextDouble(-1.0, 1.0)
          pink[0] = 0.99886 * pink[0] + white * 0.0555179
          pink[1] = 0.99332 * pink[1] + white * 0.0750759
          pink[2] = 0.96900 * pink[2] + white * 0.1538520
          pink[3] = 0.86650 * pink[3] + white * 0.3104856
          pink[4] = 0.55000 * pink[4] + white * 0.5329522
          pink[5] = -0.7616 * pink[5] - white * 0.0168980
          val pinkSample = (pink[0] + pink[1] + pink[2] + pink[3] + pink[4] + pink[5] + pink[6] + white * 0.5362) * 0.11
          pink[6] = white * 0.115926
          val n = pinkSample * noise

          buf[i * 2] = ((sin(phaseL) * tone + n) * master).toFloat()
          buf[i * 2 + 1] = ((sin(phaseR) * tone + n) * master).toFloat()
        }
        audio.write(buf, 0, buf.size, AudioTrack.WRITE_BLOCKING)
        if (targetMaster == 0.0 && master == 0.0) break
      }
    } finally {
      audio.stop()
      audio.release()
      thread = null
    }
  }

  private fun headphonesConnected(): Boolean {
    val audio = appContext.reactContext?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return false
    return audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS).any { it.type in HEADPHONE_TYPES }
  }

  private fun reportOutput() {
    val headphones = headphonesConnected()
    if (headphones == lastHeadphones) return
    lastHeadphones = headphones
    sendEvent("onOutputChange", mapOf("headphones" to headphones))
  }

  companion object {
    private val HEADPHONE_TYPES = setOf(
      AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
      AudioDeviceInfo.TYPE_WIRED_HEADSET,
      AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
      AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
      AudioDeviceInfo.TYPE_USB_HEADSET,
    )
  }
}
