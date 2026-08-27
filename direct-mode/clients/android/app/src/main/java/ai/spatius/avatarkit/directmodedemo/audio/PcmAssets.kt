package ai.spatius.avatarkit.directmodedemo.audio

import android.content.Context
import ai.spatius.avatarkit.AvatarController
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class PcmAsset(val name: String, val path: String)

/**
 * Shown under the clip list so nobody reads the bundled files as the limit of what
 * Direct Mode accepts.
 */
const val AUDIO_SOURCE_HINT =
    "Bundled samples, not a limit: send() takes any PCM16 audio at the configured " +
        "sample rate — a microphone, a TTS service, your own pipeline."

/** Same clips the web demo ships, so both demos show identical behaviour. */
val PCM_ASSETS = listOf(
    PcmAsset("Demo Audio 1", "audio/demo_pcm_audio1.pcm"),
    PcmAsset("Demo Audio 2", "audio/demo_pcm_audio2.pcm"),
    PcmAsset("Demo Audio 3", "audio/demo_pcm_audio3.pcm"),
    PcmAsset("Simple, Natural Vernacular Speaking", "audio/2 Simple, Natural Vernacular Speakin.pcm"),
    PcmAsset("Speaking With Projection", "audio/3 Speaking With Projection.pcm"),
    PcmAsset("Speaking With Line", "audio/4 Speaking With Line.pcm"),
    PcmAsset("The Downward Sigh", "audio/6 The Downward Sigh.pcm"),
)

private const val PCM_CHUNK_SIZE = 32_000
private const val PCM_CHUNK_INTERVAL_MS = 80L

suspend fun loadPcmAsset(context: Context, path: String): ByteArray =
    withContext(Dispatchers.IO) {
        context.assets.open(path).use { it.readBytes() }
    }

/**
 * Feed the clip to the SDK in chunks, the way a live TTS stream would arrive,
 * then close the turn with an empty final chunk.
 *
 * The chunking here is what matters, not the file: [AvatarController.send] accepts
 * any PCM16 at the configured sample rate, so a microphone or TTS stream feeds it
 * the same way — hand it bytes as they arrive and mark the final chunk with `end`.
 *
 * Returns the Job so the caller can cancel mid-clip; cancelling stops sending
 * but leaves whatever already reached the SDK to play out.
 */
fun sendPcmChunks(
    scope: CoroutineScope,
    data: ByteArray,
    controller: AvatarController,
    onDone: () -> Unit,
    onError: (Throwable) -> Unit,
): Job = scope.launch(Dispatchers.IO) {
    try {
        var offset = 0
        while (offset < data.size) {
            if (!isActive) return@launch
            val end = minOf(offset + PCM_CHUNK_SIZE, data.size)
            controller.send(data.copyOfRange(offset, end), false)
            offset = end
            delay(PCM_CHUNK_INTERVAL_MS)
        }
        controller.send(ByteArray(0), true)
        withContext(Dispatchers.Main) { onDone() }
    } catch (t: Throwable) {
        withContext(Dispatchers.Main) { onError(t) }
    }
}
