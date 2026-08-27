package ai.spatius.avatarkit.backendmodedemo.viewmodel

import ai.spatius.avatarkit.AudioFormat
import ai.spatius.avatarkit.AvatarController.ConnectionState
import ai.spatius.avatarkit.AvatarSDK
import ai.spatius.avatarkit.AvatarView
import ai.spatius.avatarkit.Configuration
import ai.spatius.avatarkit.DrivingServiceMode
import ai.spatius.avatarkit.LogLevel
import ai.spatius.avatarkit.assets.AvatarManager
import ai.spatius.avatarkit.player.AnimationPlayer.ConversationState
import ai.spatius.avatarkit.backendmodedemo.BuildConfig
import android.Manifest
import android.app.Application
import android.content.pm.PackageManager
import android.media.AudioRecord
import android.media.MediaRecorder
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject
import org.json.JSONArray
import kotlin.io.encoding.Base64
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

class AvatarViewModel(application: Application) : AndroidViewModel(application) {

    // --- Avatar state ---
    var avatarView: AvatarView? = null
        private set
    var isLoading: Boolean by mutableStateOf(false)
        private set
    var loadProgress: Float by mutableStateOf(0f)
        private set
    var currentAvatarId: String by mutableStateOf("")
        private set
    var configuredAvatarId: String by mutableStateOf("")
        private set

    // --- Controller state ---
    var connectionState: ConnectionState by mutableStateOf(ConnectionState.Disconnected)
        private set
    var conversationState: ConversationState by mutableStateOf(ConversationState.Idle)
        private set
    var errorState: Throwable? by mutableStateOf(null)
        private set
    /** Whether the avatar has actually been drawn — what takes the overlay down. */
    var rendered: Boolean by mutableStateOf(false)
        private set
    /** Rolling render rate, from the SDK's frame rate monitor. */
    var fps: Int? by mutableStateOf(null)
        private set

    // --- Backend Mode state ---
    var backendConnected: Boolean by mutableStateOf(false)
        private set
    var backendConnecting: Boolean by mutableStateOf(false)
        private set
    var backendMicActive: Boolean by mutableStateOf(false)
        private set
    var backendTextInput: String by mutableStateOf("")
    var isPaused: Boolean by mutableStateOf(false)
        private set

    // --- Realtime scene ---
    /** Whether the agent has been asked for. */
    var agentConnecting: Boolean by mutableStateOf(false)
        private set
    /**
     * Whether the agent is ready to be spoken to.
     *
     * The server starts it asynchronously after `start_agent`, and audio pushed before
     * `agent_ready` arrives is dropped — which presents as a microphone that records
     * and is never answered.
     */
    var agentReady: Boolean by mutableStateOf(false)
        private set
    /** What has been said so far, as (role, text). */
    var transcript: List<Pair<String, String>> by mutableStateOf(emptyList())
        private set

    /** Which language the realtime conversation runs in; set from the config screen. */
    var language: String = "en"

    /**
     * Where the server is, as typed on the config screen.
     *
     * Not BuildConfig: that is fixed at build time and defaults to the emulator's
     * 10.0.2.2, which a real device cannot reach — the address has to be the one the
     * user actually entered, or every connection fails with nothing to change.
     */
    var baseUrl: String = BuildConfig.BACKEND_MODE_URL

    /** The clips the server can play, as reported by `/api/config`. */
    var clips: List<ai.spatius.avatarkit.backendmodedemo.ui.screens.ServerClip>
        by mutableStateOf(emptyList())
    /** Which clip is mid-flight, so its button can show it. */
    var playingClip: String? by mutableStateOf(null)
        private set

    /**
     * Whether `start_agent` has been sent on this connection.
     *
     * Sent once, and only by the realtime scene: an agent costs a model session, and
     * someone who only wants the pre-recorded clips should not pay for one by opening
     * the app.
     */
    private var agentStarted = false

    private var backendWebSocket: WebSocket? = null
    private var micRecordJob: Job? = null
    private var audioRecord: AudioRecord? = null
    /**
     * The id `yieldAudioData` handed back, which the frames for the same reply need.
     *
     * One id, not a map keyed by the server's `turnId`: the SDK mints a fresh
     * conversation id as a reply goes on, and the latest is the one the frames belong
     * to. Keeping the first — which a map plus "only if absent" does — leaves every
     * later batch addressed to an id the SDK has moved past, and the clip never
     * finishes playing. The Web and iOS clients both track the single latest id.
     */
    private var conversationId: String? = null

    private val controller get() = avatarView?.controller

    var isInitialized: Boolean by mutableStateOf(false)
        private set

    private val okHttpClient = OkHttpClient()

    fun initialize(appId: String, avatarId: String = "", region: String = "us-west") {
        configuredAvatarId = avatarId
        AvatarSDK.initialize(
            getApplication(),
            appId,
            Configuration(
                region = region.ifBlank { "us-west" },
                audioFormat = AudioFormat(16000),
                drivingServiceMode = DrivingServiceMode.BACKEND,
                logLevel = LogLevel.ALL
            )
        )
        isInitialized = true
    }

    fun loadAvatar(avatarId: String) {
        if (avatarId == currentAvatarId && avatarView != null) return
        // The view is reused rather than torn down: it is what the next model is drawn
        // into, and dropping it here would leave the stage empty with nothing to
        // recreate it. Only the session behind it is reset.
        val view = avatarView
        backendDisconnect()
        connectionState = ConnectionState.Disconnected
        conversationState = ConversationState.Idle
        errorState = null
        currentAvatarId = avatarId
        rendered = false
        fps = null
        isLoading = true
        loadProgress = 0f
        viewModelScope.launch {
            try {
                val avatar = AvatarManager.load(avatarId, onProgress = { progress ->
                    when (progress) {
                        is AvatarManager.LoadProgress.Downloading -> loadProgress = progress.progress
                        is AvatarManager.LoadProgress.Completed -> loadProgress = 1f
                        is AvatarManager.LoadProgress.Failed -> errorState = progress.error
                    }
                })
                view?.init(avatar, viewModelScope)
                setupController()
                backendConnect()
            } catch (error: Throwable) {
                errorState = error
                currentAvatarId = ""
            } finally {
                isLoading = false
            }
        }
    }

    fun onAvatarViewCreated(view: AvatarView) {
        avatarView = view
        // Nothing to draw yet: the id arrives from the server, and the caller loads it
        // through loadAvatar once this view exists.
        if (currentAvatarId.isBlank()) return
        viewModelScope.launch {
            val avatar = AvatarManager.load(currentAvatarId)
            view.init(avatar, viewModelScope)
            setupController()
            // Nothing to ask the user here: this is a WebSocket to the demo's own
            // server, not a session that costs anything. The iOS client connects at the
            // same point, and neither has a Start button — the server owns the Motion
            // Server connection, so there is nothing for one to start.
            backendConnect()
        }
    }

    /**
     * Load the avatar the server nominated, into the view that already exists.
     *
     * Not loadAvatar: that one tears the view down first, which is right when swapping
     * characters and wrong here — the view was created a moment ago and is what the
     * model is about to be drawn into.
     */
    fun loadInitialAvatar(avatarId: String) {
        if (avatarId.isBlank() || currentAvatarId.isNotBlank()) return
        val view = avatarView ?: return
        currentAvatarId = avatarId
        rendered = false
        isLoading = true
        loadProgress = 0f
        viewModelScope.launch {
            try {
                val avatar = AvatarManager.load(avatarId) { progress ->
                    when (progress) {
                        is AvatarManager.LoadProgress.Downloading -> loadProgress = progress.progress
                        is AvatarManager.LoadProgress.Completed -> loadProgress = 1f
                        is AvatarManager.LoadProgress.Failed -> errorState = progress.error
                    }
                }
                view.init(avatar, viewModelScope)
                setupController()
                backendConnect()
            } catch (error: Throwable) {
                errorState = error
                currentAvatarId = ""
            } finally {
                isLoading = false
            }
        }
    }

    private fun setupController() {
        controller?.apply {
            onConnectionState = { state -> connectionState = state }
            onConversationState = { state -> conversationState = state }
            onError = { error -> errorState = Exception(error.message) }
            // Off by default and free while off; the status bar is what asks for it.
            frameRateMonitorEnabled = true
            onFrameRateInfo = { info -> fps = info.fps.toInt() }
        }
        avatarView?.onFirstRendering = { rendered = true }
    }

    fun pause() { controller?.pause(); isPaused = true }
    fun resume() { controller?.resume(); isPaused = false }

    /**
     * Cut off what the avatar is saying.
     *
     * The microphone stays open: interrupting means "stop talking", not "I am done
     * talking" — closing it here made every interruption end the turn as well.
     */
    fun interrupt() {
        controller?.interrupt()
    }

    // ========== Backend Mode: WebSocket ==========

    private fun handleHostMessage(text: String) {
        val obj = try { JSONObject(text) } catch (_: Exception) { return }
        val type = obj.optString("type", "") .ifEmpty { return }

        when (type) {
            "ready" -> {
                backendConnected = true
                backendConnecting = false
                backendWebSocket?.send(JSONObject().apply { put("type", "set_avatar"); put("avatarId", currentAvatarId) }.toString())
            }
            "avatar_audio" -> {
                val audioB64 = obj.optString("audio", "")
                val isLast = obj.optBoolean("isLast", false)
                val audioBytes = if (audioB64.isNotEmpty()) Base64.decode(audioB64) else ByteArray(0)
                // Queued on the same single-threaded scope as the frames below, so the
                // id is always set before the frames that need it arrive — the two
                // messages are independent on the wire and can land in either order.
                viewModelScope.launch {
                    conversationId = controller?.yieldAudioData(audioBytes, isLast) ?: conversationId
                    // The button showing "…" goes back to the clip's name once the
                    // server has sent the last of it.
                    if (isLast) playingClip = null
                }
            }
            "avatar_frames" -> {
                val framesArr = obj.optJSONArray("frames") ?: return
                val frames = (0 until framesArr.length()).mapNotNull { i ->
                    framesArr.optString(i)?.takeIf { it.isNotEmpty() }?.let { Base64.decode(it) }
                }
                if (frames.isEmpty()) return
                viewModelScope.launch {
                    val cid = conversationId ?: return@launch
                    controller?.yieldFramesData(frames, cid)
                }
            }
            "agent_ready" -> {
                agentConnecting = false
                agentReady = true
            }
            "transcript" -> {
                val role = obj.optString("role", "user")
                val said = obj.optString("text", "")
                if (said.isNotEmpty()) transcript = transcript + (role to said)
            }
            "interrupt" -> {
                conversationId = null
                viewModelScope.launch { controller?.interrupt() }
            }
            "error" -> {
                playingClip = null
                val errMsg = obj.optString("message", "Unknown error")
                viewModelScope.launch { errorState = Exception(errMsg) }
            }
        }
    }

    fun backendConnect() {
        if (backendWebSocket != null || backendConnecting) return
        backendConnecting = true
        errorState = null

        val wsUrl = baseUrl.let { url ->
            if (url.startsWith("ws://") || url.startsWith("wss://")) url
            else url.replace("http://", "ws://").replace("https://", "wss://")
        }.let { base ->
            if (base.endsWith("/ws/agent")) base else "$base/ws/agent"
        }

        val request = Request.Builder().url(wsUrl).build()
        val ws = okHttpClient.newWebSocket(request, object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) {
                handleHostMessage(text)
            }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                viewModelScope.launch {
                    errorState = t
                    backendConnecting = false
                    backendConnected = false
                    resetAgent()
                    backendWebSocket = null
                    backendMicActive = false
                }
            }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                viewModelScope.launch {
                    backendWebSocket = null
                    backendConnected = false
                    resetAgent()
                    backendConnecting = false
                    backendMicActive = false
                    conversationId = null
                }
            }
        })
        backendWebSocket = ws
    }

    /** Forget the agent. It belongs to the socket, so a new connection needs a new one. */
    private fun resetAgent() {
        agentStarted = false
        agentConnecting = false
        agentReady = false
    }

    fun backendDisconnect() {
        backendStopMic()
        backendWebSocket?.close(1000, "User disconnected")
        backendWebSocket = null
        backendConnected = false
        resetAgent()
        backendConnecting = false
        conversationId = null
    }

    fun hasRecordPermission(): Boolean {
        return ContextCompat.checkSelfPermission(
            getApplication(),
            Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED
    }

    @android.annotation.SuppressLint("MissingPermission")
    /**
     * Ask the server to start the conversational agent, once per connection.
     *
     * Only the realtime scene calls this: an agent costs a model session, and a clip
     * needs none. `agent_ready` comes back when it can actually be spoken to.
     */
    private fun ensureAgent() {
        if (agentStarted) return
        val ws = backendWebSocket ?: return
        agentStarted = true
        agentConnecting = true
        ws.send(JSONObject().apply { put("type", "start_agent"); put("language", language) }.toString())
    }

    fun backendStartMic() {
        if (backendMicActive) return
        // The server drops audio that arrives before the agent exists, so the mic
        // starting is what brings it up.
        ensureAgent()
        if (!hasRecordPermission()) return

        val sampleRate = 16000
        val channelConfig = android.media.AudioFormat.CHANNEL_IN_MONO
        val audioEncoding = android.media.AudioFormat.ENCODING_PCM_16BIT
        val minBufSize = AudioRecord.getMinBufferSize(sampleRate, channelConfig, audioEncoding)
        val bufferSize = maxOf(minBufSize, sampleRate * 2)

        val record = AudioRecord(
            MediaRecorder.AudioSource.MIC,
            sampleRate,
            channelConfig,
            audioEncoding,
            bufferSize
        )

        if (record.state != AudioRecord.STATE_INITIALIZED) {
            errorState = Exception("AudioRecord initialization failed")
            return
        }

        audioRecord = record
        record.startRecording()
        backendMicActive = true

        micRecordJob = viewModelScope.launch(Dispatchers.IO) {
            val chunkSize = sampleRate * 2 * 200 / 1000 // 200ms of 16kHz 16-bit mono
            val buffer = ByteArray(chunkSize)
            try {
                while (isActive && backendMicActive) {
                    val read = record.read(buffer, 0, chunkSize)
                    if (read > 0) {
                        val chunk = if (read == chunkSize) buffer else buffer.copyOf(read)
                        val b64 = Base64.encode(chunk)
                        backendWebSocket?.send(JSONObject().apply { put("type", "mic_audio"); put("audio", b64) }.toString())
                    }
                }
            } catch (_: CancellationException) {
                // normal cancellation
            }
        }
    }

    fun backendStopMic() {
        if (!backendMicActive) return
        backendMicActive = false
        micRecordJob?.cancel()
        micRecordJob = null
        try {
            audioRecord?.stop()
            audioRecord?.release()
        } catch (_: Exception) {}
        audioRecord = null
        backendWebSocket?.send(JSONObject().apply { put("type", "mic_end") }.toString())
    }

    /**
     * Ask the server to stream one of its clips into the avatar.
     *
     * The clips live on the server and never pass through this app: what arrives back
     * is the same audio-plus-motion pair the realtime scene produces, so the rendering
     * path is identical either way.
     */
    fun playSample(clip: String) {
        if (!backendConnected) backendConnect()
        playingClip = clip
        backendWebSocket?.send(
            JSONObject().apply { put("type", "play_sample"); put("clip", clip) }.toString()
        )
    }

    fun backendSendText(text: String) {
        val trimmed = text.trim()
        if (trimmed.isEmpty()) return
        if (!backendConnected) backendConnect()
        // A typed line goes to the same agent the microphone talks to.
        ensureAgent()
        backendWebSocket?.send(JSONObject().apply { put("type", "text"); put("text", trimmed) }.toString())
        backendTextInput = ""
    }

    fun cleanupAvatar() {
        backendDisconnect()
        avatarView = null
        connectionState = ConnectionState.Disconnected
        conversationState = ConversationState.Idle
        errorState = null
        loadProgress = 0f
    }

    override fun onCleared() {
        super.onCleared()
        cleanupAvatar()
    }
}
