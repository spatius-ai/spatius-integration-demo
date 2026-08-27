package ai.spatius.avatarkit.directmodedemo.realtime

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch

/**
 * Microphone capture at the rate the SDK was initialized with.
 *
 * PCM16 mono, read in small blocks and handed straight up — the agent decides on its
 * own when a turn has ended, so nothing here buffers a whole utterance.
 */
class MicrophoneCapture(private val sampleRate: Int = 16000) {

    private var record: AudioRecord? = null
    private var job: Job? = null

    val isActive: Boolean get() = record != null

    /** @throws SecurityException when RECORD_AUDIO has not been granted. */
    @SuppressLint("MissingPermission")
    fun start(scope: CoroutineScope, onChunk: (ByteArray) -> Unit) {
        if (record != null) return

        val minBuffer = AudioRecord.getMinBufferSize(
            sampleRate,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
        )
        check(minBuffer > 0) { "This device cannot record at ${sampleRate}Hz" }

        // Twice the minimum: at exactly the minimum a slow read drops samples, which
        // reaches the agent as clipped words rather than as an error.
        val bufferSize = minBuffer * 2
        val recorder = AudioRecord(
            MediaRecorder.AudioSource.VOICE_COMMUNICATION,
            sampleRate,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            bufferSize,
        )
        check(recorder.state == AudioRecord.STATE_INITIALIZED) {
            "Could not open the microphone"
        }

        record = recorder
        recorder.startRecording()

        job = scope.launch(Dispatchers.IO) {
            val buffer = ByteArray(bufferSize)
            while (true) {
                ensureActive()
                val read = recorder.read(buffer, 0, buffer.size)
                if (read > 0) onChunk(buffer.copyOf(read))
            }
        }
    }

    fun stop() {
        job?.cancel()
        job = null
        // Stopped and released together: leaving the recorder open keeps the
        // microphone indicator lit and blocks the next start.
        record?.runCatching { stop() }
        record?.runCatching { release() }
        record = null
    }
}
