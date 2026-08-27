package ai.spatius.avatarkit.directmodedemo.realtime

import android.util.Base64
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.coroutines.suspendCoroutine

/**
 * The realtime scene's link to the backend agent.
 *
 * Direct Mode either way: the client owns the Motion Server connection and drives the
 * avatar itself. The scenes differ only in where the audio comes from —
 *
 *   pre-recorded  a bundled .pcm file  ──────────────────►  controller.send()
 *   realtime      mic ──ws──► agent (ASR/LLM/TTS) ──ws──►  controller.send()
 *
 * — so both end at the same call and the rendering side is untouched.
 *
 * There is no LiveKit SDK here on purpose. The agent runs server-side without a room:
 * `AgentSession` only builds a RoomIO when its audio input and output are unset, and
 * the backend sets both (see servers/python/realtime.py), so its speech comes back
 * over this plain WebSocket as PCM16.
 */
class RealtimeClient(
    private val callbacks: Callbacks,
) {
    interface Callbacks {
        /** A reply started arriving; the bytes are PCM16 for `controller.send`. */
        fun onAudio(pcm: ByteArray)
        /** The agent finished a reply — the empty final send closes the turn. */
        fun onTurnEnd()
        /** The user talked over the reply; drop what has not played yet. */
        fun onInterrupt()
        fun onTranscript(role: String, text: String)
        fun onError(message: String)
        fun onClosed()
    }

    private var socket: WebSocket? = null

    @Volatile
    var isReady: Boolean = false
        private set

    private val http = OkHttpClient.Builder()
        // The agent holds the socket open between turns, so no read timeout.
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .connectTimeout(15, TimeUnit.SECONDS)
        .build()

    /** Connect, and resolve once the agent is up and listening. */
    suspend fun connect(url: String, language: String): Unit = suspendCoroutine { cont ->
        var settled = false

        val listener = object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                webSocket.send(JSONObject().put("type", "start").put("language", language).toString())
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                val msg = runCatching { JSONObject(text) }.getOrNull() ?: return
                when (msg.optString("type")) {
                    "ready" -> {
                        isReady = true
                        if (!settled) { settled = true; cont.resume(Unit) }
                    }
                    "audio" -> {
                        val encoded = msg.optString("audio")
                        if (encoded.isNotEmpty()) {
                            callbacks.onAudio(Base64.decode(encoded, Base64.DEFAULT))
                        }
                    }
                    "turn_end" -> callbacks.onTurnEnd()
                    "interrupt" -> callbacks.onInterrupt()
                    "transcript" -> callbacks.onTranscript(
                        msg.optString("role"),
                        msg.optString("text"),
                    )
                    "error" -> {
                        val message = msg.optString("message").ifEmpty { "Agent error" }
                        callbacks.onError(message)
                        if (!settled) { settled = true; cont.resumeWithException(IllegalStateException(message)) }
                    }
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                isReady = false
                if (!settled) {
                    settled = true
                    cont.resumeWithException(IllegalStateException("Cannot reach the agent at $url"))
                } else {
                    callbacks.onError(t.message ?: "Agent connection failed")
                }
                callbacks.onClosed()
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                isReady = false
                callbacks.onClosed()
            }
        }

        socket = http.newWebSocket(Request.Builder().url(url).build(), listener)
    }

    /** Microphone audio, as PCM16 at the rate the SDK was initialized with. */
    fun pushMicAudio(pcm: ByteArray) {
        val ws = socket ?: return
        if (!isReady) return
        ws.send(
            JSONObject()
                .put("type", "mic_audio")
                .put("audio", Base64.encodeToString(pcm, Base64.NO_WRAP))
                .toString()
        )
    }

    /** Speak a fixed line, for trying the scene without a microphone. */
    fun say(text: String) {
        socket?.send(JSONObject().put("type", "text").put("text", text).toString())
    }

    fun interrupt() {
        socket?.send(JSONObject().put("type", "interrupt").toString())
    }

    fun close() {
        isReady = false
        socket?.close(1000, null)
        socket = null
    }
}
