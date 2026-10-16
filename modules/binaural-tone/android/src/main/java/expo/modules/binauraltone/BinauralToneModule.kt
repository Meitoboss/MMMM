package expo.modules.binauraltone

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.sin

/** Makes the sine tone on the phone, in a stream that never ends (Android). The math is the same as on iOS (see the Swift file). */
class BinauralToneModule : Module() {
  private val rate = 48_000
  private var track: AudioTrack? = null
  private var thread: Thread? = null

  @Volatile private var running = false
  @Volatile private var targetFreqL = 200.0
  @Volatile private var targetFreqR = 200.0
  @Volatile private var targetGain = 0f

  override fun definition() = ModuleDefinition {
    Name("BinauralTone")

    Function("start") { baseHz: Double, beatHz: Double, volume: Double ->
      start(baseHz, beatHz, volume.toFloat())
    }
    Function("setVolume") { volume: Double ->
      targetGain = volume.toFloat()
    }
    Function("stop") {
      stop()
    }
  }

  private fun start(baseHz: Double, beatHz: Double, volume: Float) {
    targetFreqL = maxOf(1.0, baseHz - beatHz / 2)
    targetFreqR = maxOf(1.0, baseHz + beatHz / 2)
    targetGain = volume
    if (running) return

    val minSize = AudioTrack.getMinBufferSize(rate, AudioFormat.CHANNEL_OUT_STEREO, AudioFormat.ENCODING_PCM_FLOAT)
    val newTrack = AudioTrack.Builder()
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
    track = newTrack
    running = true
    newTrack.play()
    thread = Thread { renderLoop(newTrack) }.apply { priority = Thread.MAX_PRIORITY; start() }
  }

  /** Writes the tone in small blocks, forever, until stop() is called. Frequency and loudness glide to their targets. */
  private fun renderLoop(audio: AudioTrack) {
    val block = 1024
    val buf = FloatArray(block * 2)
    val twoPi = 2.0 * PI
    val glide = 1.0 - exp(-1.0 / (0.15 * rate))
    var freqL = targetFreqL
    var freqR = targetFreqR
    var gain = 0.0
    var phaseL = 0.0
    var phaseR = 0.0
    while (running) {
      for (i in 0 until block) {
        freqL += (targetFreqL - freqL) * glide
        freqR += (targetFreqR - freqR) * glide
        gain += (targetGain - gain) * glide
        phaseL += twoPi * freqL / rate
        phaseR += twoPi * freqR / rate
        if (phaseL > twoPi) phaseL -= twoPi
        if (phaseR > twoPi) phaseR -= twoPi
        buf[i * 2] = (sin(phaseL) * gain).toFloat()
        buf[i * 2 + 1] = (sin(phaseR) * gain).toFloat()
      }
      audio.write(buf, 0, buf.size, AudioTrack.WRITE_BLOCKING)
    }
    audio.stop()
    audio.release()
  }

  private fun stop() {
    targetGain = 0f
    running = false
    thread = null
    track = null
  }
}
