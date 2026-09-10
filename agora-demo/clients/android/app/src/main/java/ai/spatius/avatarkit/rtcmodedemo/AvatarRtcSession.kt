package ai.spatius.avatarkit.rtcmodedemo

import ai.spatius.avatarkit.AvatarSDK
import ai.spatius.avatarkit.AvatarView
import ai.spatius.avatarkit.Configuration
import ai.spatius.avatarkit.DrivingServiceMode
import ai.spatius.avatarkit.LogLevel
import ai.spatius.avatarkit.assets.AvatarManager
import ai.spatius.avatarkit.rtc.AgoraConnectionConfig
import ai.spatius.avatarkit.rtc.AvatarPlayer
import ai.spatius.avatarkit.rtc.AvatarPlayerEvent
import ai.spatius.avatarkit.rtc.AvatarPlayerOptions
import ai.spatius.avatarkit.rtc.RTCLogLevel
import ai.spatius.avatarkit.rtc.providers.AgoraProvider
import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.agora.rtc2.IRtcEngineEventHandler
import io.agora.rtc2.RtcEngine
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * The avatar's RTC session: ask the server for a channel, initialize the SDK, load the
 * avatar, connect, publish the microphone.
 *
 * RTC Mode is the one path where the avatar joins the call itself. This client feeds it
 * no driving data at all: the agent encodes the animation into the video stream's SEI,
 * the SDK parses it out to drive rendering, and audio travels on an RTC audio track.
 *
 *     Direct    client ──audio──►  Motion Server           (client drives)
 *     Backend   client ──mic───►  server ──► Motion Server (server drives)
 *     RTC       client ◄────  RTC channel  ────► agent     (neither — it is in the call)
 *
 * So there is no `send()` and no `yieldAudioData()` here. Once connected, everything
 * arrives as a stream.
 */
class AvatarRtcSession(application: Application) : AndroidViewModel(application) {

    /** Stage text for the waiting overlay. */
    var status: String by mutableStateOf("Preparing…")
        private set
    /** Model download progress, 0-100. Only moves on a cache miss. */
    var downloadPercent: Int? by mutableStateOf(null)
        private set
    /** Whether the avatar's first frame has rendered — what dismisses the overlay. */
    var isReady: Boolean by mutableStateOf(false)
        private set
    /**
     * Whether the agent has joined and can be spoken to.
     *
     * The microphone stays disabled until this flips: audio published earlier is
     * dropped without an error anywhere.
     */
    var agentReady: Boolean by mutableStateOf(false)
        private set
    /** Whether the microphone is currently published. */
    var micActive: Boolean by mutableStateOf(false)
        private set
    /** The last failure, shown in the room rather than replacing it. */
    var errorMessage: String? by mutableStateOf(null)
        private set

    /** The render view, created once the avatar has loaded. */
    var avatarView: AvatarView? by mutableStateOf(null)
        private set

    private var provider: AgoraProvider? = null
    private var player: AvatarPlayer? = null
    private var baseUrl = ""
    /** The session id issued by the server, used on the way out to stop billing. */
    private var sessionId = ""
    /** The conversational agent's uid, watched for in the channel. */
    private var agentUid = 0L
    /**
     * A session bills from the moment it is created, and Compose may fire the effect
     * that starts one more than once.
     */
    private var hasStarted = false

    private var sdkInitialized = false

    /**
     * Create the session, load the avatar, and join the channel.
     *
     * Idempotent. On failure the session is stopped and the guard released, so the
     * caller can retry.
     */
    fun start(baseUrl: String, language: String, avatarId: String = "") {
        if (hasStarted) return
        hasStarted = true
        this.baseUrl = baseUrl
        this.language = language
        errorMessage = null

        viewModelScope.launch {
            try {
                status = "Creating a session…"
                val credentials = AgentClient.createSession(baseUrl, language, avatarId)
                sessionId = credentials.sessionId
                agentUid = credentials.agentUid.toLong() and 0xFFFFFFFFL

                initializeSdk(credentials.spatiusAppId, credentials.spatiusRegion)

                // From here on the session is billing, so any later failure has to stop it.
                status = "Loading avatar…"
                val avatar = AvatarManager.load(credentials.avatarId) { progress ->
                    if (progress is AvatarManager.LoadProgress.Downloading) {
                        downloadPercent = (progress.progress * 100).toInt().coerceIn(0, 100)
                    }
                } ?: error("Avatar load returned null")
                downloadPercent = null

                val view = AvatarView(getApplication())
                view.init(avatar, viewModelScope)
                view.onFirstRendering = { isReady = true }
                avatarView = view

                status = "Joining the channel…"
                val agoraProvider = AgoraProvider(getApplication<Application>().applicationContext)
                val avatarPlayer = AvatarPlayer(
                    agoraProvider,
                    view,
                    AvatarPlayerOptions(logLevel = RTCLogLevel.INFO),
                )
                provider = agoraProvider
                player = avatarPlayer

                // Subscribed before connecting, or the events fired at the moment of
                // connection are missed.
                avatarPlayer.subscribe { event -> handleEvent(event) }

                avatarPlayer.connect(
                    AgoraConnectionConfig(
                        appId = credentials.appId,
                        channel = credentials.channelName,
                        token = credentials.token,
                        uid = credentials.uid.toLong(),
                    )
                )
                status = "Connected"
                // Treat a connection as good enough to show the picture: the first-frame
                // callback can fire before it is registered, and waiting on it alone
                // would leave the overlay up forever.
                isReady = true

                // The agent arrives a beat later; the microphone waits for it.
                awaitAgentJoined()
                agentReady = true
            } catch (t: Throwable) {
                runCatching { AgentClient.stopSession(baseUrl, sessionId) }
                sessionId = ""
                player = null
                provider = null
                // Released so a retry is possible; otherwise the guard blocks every
                // subsequent attempt too.
                hasStarted = false
                status = "Could not start"
                errorMessage = t.message ?: t.javaClass.simpleName
            }
        }
    }

    /**
     * Global SDK initialization; idempotent.
     *
     * `.RTC` has to be declared: AvatarPlayer validates it, and getting it wrong files
     * this path's telemetry under the wrong mode.
     *
     * The app id comes from the server rather than from this device: it has to match
     * the one the server used to start the avatar, and a mismatch connects fine but
     * shows nothing.
     */
    private fun initializeSdk(appId: String, region: String) {
        if (sdkInitialized) return
        sdkInitialized = true
        AvatarSDK.initialize(
            getApplication<Application>().applicationContext,
            appId,
            Configuration(
                region = region.ifEmpty { "cn-beijing" },
                drivingServiceMode = DrivingServiceMode.RTC,
                logLevel = LogLevel.WARNING,
            ),
        )
        AvatarManager.initialize(getApplication<Application>().applicationContext)
    }

    /**
     * Wait for the ConvoAI agent to join the channel.
     *
     * `connect()` returning only means this device joined; the agent is started
     * asynchronously by ConvoAI after `/api/session` returns, measured at a second or
     * two later. Audio published during that window is dropped, and the symptom is a
     * channel that connects but never answers.
     *
     * The match is on the agent uid the server minted: the avatar's own publishing
     * endpoint is in the channel too and generally joins first, so keying off "some
     * remote user appeared" matches the wrong one.
     *
     * A timeout also lets us through — an agent that never joins is the server's
     * problem, and the picture still works.
     */
    private suspend fun awaitAgentJoined(timeoutMs: Long = 20_000) {
        val engine = provider?.getNativeClient() as? RtcEngine ?: return
        if (agentUid <= 0) return

        val joined = CompletableDeferred<Unit>()
        val handler = object : IRtcEngineEventHandler() {
            override fun onUserJoined(uid: Int, elapsed: Int) {
                if (uid.toLong() and 0xFFFFFFFFL == agentUid) joined.complete(Unit)
            }
        }
        // addHandler rather than taking over the delegate: the engine supports several,
        // so the SDK's own listener keeps working.
        engine.addHandler(handler)
        try {
            withTimeoutOrNull(timeoutMs) { joined.await() }
        } finally {
            engine.removeHandler(handler)
        }
    }

    /**
     * Switch to another avatar.
     *
     * The avatar is chosen when the ConvoAI agent is started, so it cannot be swapped
     * on a running session: the old one is stopped — it bills until it is — and a new
     * one is created against the new id.
     */
    fun switchAvatar(avatarId: String) {
        val url = baseUrl
        val lang = language
        viewModelScope.launch {
            runCatching { player?.disconnect() }
            AgentClient.stopSession(url, sessionId)
            resetForRestart()
            start(url, lang, avatarId)
        }
    }

    /** The language the current session was created with, so a restart keeps it. */
    private var language = "en"

    /** Clear everything a new session will set again. */
    private fun resetForRestart() {
        player = null
        provider = null
        sessionId = ""
        agentUid = 0
        avatarView = null
        isReady = false
        agentReady = false
        micActive = false
        hasStarted = false
        status = "Preparing…"
    }

    /** Publish the microphone. The SDK opens the device itself. */
    fun publishMic() {
        if (micActive || player == null) return
        viewModelScope.launch {
            runCatching { player?.publishAudio() }
                .onSuccess { micActive = true }
                .onFailure { errorMessage = it.message ?: it.javaClass.simpleName }
        }
    }

    fun unpublishMic() {
        if (!micActive) return
        viewModelScope.launch {
            runCatching { player?.unpublishAudio() }
            micActive = false
        }
    }

    private fun handleEvent(event: AvatarPlayerEvent) {
        when (event) {
            // Reconnect on a stalled stream, so the picture does not freeze.
            is AvatarPlayerEvent.Stalled -> viewModelScope.launch {
                runCatching { player?.reconnect() }
            }
            else -> Unit
        }
    }

    /**
     * Disconnect and stop the session.
     *
     * Explicit rather than left to the channel's idle timeout: that waits a minute, and
     * the minute is billed.
     */
    fun stop() {
        val url = baseUrl
        val id = sessionId
        viewModelScope.launch {
            runCatching { player?.disconnect() }
            AgentClient.stopSession(url, id)
        }
        player = null
        provider = null
        sessionId = ""
        agentUid = 0
        avatarView = null
        isReady = false
        agentReady = false
        micActive = false
        hasStarted = false
    }

    override fun onCleared() {
        super.onCleared()
        stop()
    }
}
