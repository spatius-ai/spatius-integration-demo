package ai.spatius.avatarkit.directmodedemo

import ai.spatius.avatarkit.AudioFormat
import ai.spatius.avatarkit.AvatarController
import ai.spatius.avatarkit.AvatarSDK
import ai.spatius.avatarkit.AvatarView
import ai.spatius.avatarkit.Configuration
import ai.spatius.avatarkit.DrivingServiceMode
import ai.spatius.avatarkit.LogLevel
import ai.spatius.avatarkit.assets.AvatarManager
import ai.spatius.avatarkit.player.AnimationPlayer.ConversationState
import ai.spatius.avatarkit.directmodedemo.config.BackendClient
import ai.spatius.avatarkit.directmodedemo.data.DEFAULT_CHARACTERS
import ai.spatius.avatarkit.directmodedemo.realtime.MicrophoneCapture
import ai.spatius.avatarkit.directmodedemo.realtime.RealtimeClient
import ai.spatius.avatarkit.directmodedemo.ui.BootScreen
import ai.spatius.avatarkit.directmodedemo.ui.CharacterPicker
import ai.spatius.avatarkit.directmodedemo.ui.PlaybackState
import ai.spatius.avatarkit.directmodedemo.ui.PlaygroundScreen
import ai.spatius.avatarkit.directmodedemo.ui.StatusRow
import ai.spatius.avatarkit.directmodedemo.ui.ToastHost
import ai.spatius.avatarkit.directmodedemo.ui.ToastKind
import ai.spatius.avatarkit.directmodedemo.ui.ToastMessage
import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Direct Mode, on Android.
 *
 * There is no configuration screen: everything the SDK needs — the App ID, the
 * region, the avatar — comes from the server's `/api/config`, and the Session Token
 * is minted there too. Credentials never reach this device. The server's address is
 * the one thing this build has to know, and it is a build-time constant
 * (`BuildConfig.DIRECT_MODE_URL`, set from `local.properties`).
 */
class MainActivity : ComponentActivity() {

    /** Where the Direct Mode server is. Compiled in; see local.properties.example. */
    private val baseUrl = BuildConfig.DIRECT_MODE_URL

    // ---- Boot
    private var serverConfig by mutableStateOf<BackendClient.ServerConfig?>(null)
    private var booting by mutableStateOf(true)
    private var bootError by mutableStateOf("")

    // ---- Playground
    private var characterId by mutableStateOf("")
    private var characterName by mutableStateOf("")
    private var showPicker by mutableStateOf(false)
    private var loading by mutableStateOf(false)
    private var loadProgress by mutableStateOf(0)
    private var rendered by mutableStateOf(false)
    private var errorMsg by mutableStateOf("")
    private var sdkError by mutableStateOf<String?>(null)

    private var connectionState by mutableStateOf("disconnected")
    private var playback by mutableStateOf(PlaybackState.Idle)
    private var fps by mutableStateOf<Int?>(null)
    private var connected by mutableStateOf(false)
    private var connecting by mutableStateOf(false)

    // ---- Conversation
    private var micOn by mutableStateOf(false)
    private var agentConnecting by mutableStateOf(false)
    private var agentReady by mutableStateOf(false)
    private var transcript by mutableStateOf<List<Pair<String, String>>>(emptyList())

    private var toast by mutableStateOf<ToastMessage?>(null)
    private var toastSerial = 0L

    private var avatarView: AvatarView? = null
    private var sdkInitialized = false
    private var realtime: RealtimeClient? = null
    private val mic = MicrophoneCapture()
    private val connectionReady = AtomicBoolean(false)

    /** Set while the microphone permission prompt is up, so the tap can resume after. */
    private var pendingMicStart = false

    private val micPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted && pendingMicStart) {
            pendingMicStart = false
            startMic()
        } else if (!granted) {
            pendingMicStart = false
            showToast("Microphone permission was denied.")
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        boot()

        setContent {
            MaterialTheme {
                Box(modifier = Modifier.fillMaxSize()) {
                    if (serverConfig == null) {
                        BootScreen(
                            booting = booting,
                            errorMsg = bootError,
                            onRetry = { boot() },
                        )
                    } else {
                        PlaygroundScreen(
                            characterName = characterName,
                            loading = loading,
                            loadProgress = loadProgress,
                            rendered = rendered,
                            errorMsg = errorMsg,
                            statusRows = statusRows(),
                            connected = connected,
                            connecting = connecting,
                            playback = playback,
                            canCreateAvatarView = sdkInitialized,
                            micOn = micOn,
                            agentConnecting = agentConnecting,
                            agentReady = agentReady,
                            transcript = transcript,
                            onPickCharacter = { showPicker = true },
                            onStart = { connect() },
                            onInterrupt = { interrupt() },
                            onPause = { runCatching { avatarView?.controller?.pause() } },
                            onResume = { runCatching { avatarView?.controller?.resume() } },
                            onToggleMic = { toggleMic() },
                            onSay = { say(it) },
                            onAvatarViewCreated = { view ->
                                if (avatarView !== view) {
                                    avatarView = view
                                    // The avatar the server nominates loads as soon as
                                    // there is a view to draw it into.
                                    if (characterId.isNotBlank() && !rendered && !loading) {
                                        loadAvatar(characterId, characterName)
                                    }
                                }
                            },
                        )

                        if (showPicker) {
                            CharacterPicker(
                                selectedId = characterId,
                                loading = loading,
                                onSelect = { id, name ->
                                    showPicker = false
                                    loadAvatar(id, name)
                                },
                                onDismiss = { showPicker = false },
                            )
                        }
                    }

                    ToastHost(
                        message = toast,
                        onDismiss = { toast = null },
                        modifier = Modifier.align(Alignment.TopCenter),
                    )
                }
            }
        }
    }

    // ---------------------------------------------------------------- boot

    /**
     * Fetch the server's configuration, mint a token, initialize the SDK.
     *
     * The whole of the credential path: nothing is typed, and the API key never
     * reaches this device — the server exchanges the one in its own `.env` for a
     * short-lived Session Token, which is what the SDK gets.
     */
    private fun boot() {
        booting = true
        bootError = ""

        lifecycleScope.launch {
            runCatching {
                val config = BackendClient.fetchConfig(baseUrl)
                val token = BackendClient.fetchSessionToken(baseUrl)
                val configuration = if (config.region.isBlank() || config.region == "auto") {
                    Configuration(
                        audioFormat = AudioFormat(config.sampleRate),
                        drivingServiceMode = DrivingServiceMode.DIRECT,
                        logLevel = LogLevel.ALL,
                    )
                } else {
                    Configuration(
                        region = config.region.lowercase(Locale.US),
                        audioFormat = AudioFormat(config.sampleRate),
                        drivingServiceMode = DrivingServiceMode.DIRECT,
                        logLevel = LogLevel.ALL,
                    )
                }
                AvatarSDK.initialize(applicationContext, config.appId, configuration)
                AvatarManager.initialize(applicationContext)
                AvatarSDK.sessionToken = token
                config
            }.onSuccess { config ->
                sdkInitialized = true
                if (characterId.isBlank()) {
                    // Whatever the server nominates, so the playground is never empty.
                    characterId = config.avatarId
                    characterName = DEFAULT_CHARACTERS
                        .firstOrNull { it.first == config.avatarId }?.second.orEmpty()
                }
                serverConfig = config
            }.onFailure {
                bootError = it.message ?: it.javaClass.simpleName
            }
            booting = false
        }
    }

    // ---------------------------------------------------------------- playground


    private fun loadAvatar(id: String, name: String) {
        val view = avatarView ?: return
        if (loading) return

        characterId = id
        characterName = name

        lifecycleScope.launch {
            loading = true
            rendered = false
            errorMsg = ""
            loadProgress = 0
            sdkError = null
            connectionReady.set(false)
            connected = false
            // Reset what the status bar shows, not just what the code branches on.
            // Closing the controller below drops the connection, but the new one stays
            // quiet until Start is pressed — so onConnectionState never fires to
            // correct the row, and it sits there claiming "connected" against an
            // avatar that has none.
            connectionState = "disconnected"
            connecting = false
            playback = PlaybackState.Idle
            fps = null
            closeAgent()
            runCatching { view.controller?.close() }

            try {
                // Advisory only. The SDK's verdict comes from a SoC list or a short CPU
                // benchmark, and the benchmark can dip on a busy or warm device; a false
                // here means "may be slow", not "cannot render", so warn and carry on.
                if (!AvatarSDK.isDeviceSupported()) {
                    showToast("This device scored below AvatarKit's recommended performance; rendering may stutter.")
                }
                val avatar = withContext(Dispatchers.IO) {
                    AvatarManager.load(id) { progress ->
                        if (progress is AvatarManager.LoadProgress.Downloading) {
                            loadProgress = (progress.progress * 100).toInt().coerceIn(0, 100)
                        }
                    }
                }
                view.init(avatar, lifecycleScope)
                bindCallbacks(view.controller)
                loading = false
                // `rendered` is set by onFirstRendering, not here: the avatar is only
                // actually on screen once that fires.
            } catch (t: Throwable) {
                loading = false
                errorMsg = t.message ?: t.javaClass.simpleName
                showToast("Failed to load avatar: $errorMsg")
            }
        }
    }

    /**
     * The state name out of whatever `toString()` returned.
     *
     * These states are classes rather than an enum, so an instance stringifies as
     * `ai.spatius…avatarcontroller$connectionstate$connected@4c5afe1` — the name is in
     * there, buried between the last `$` and the `@`. The comparisons below survive it
     * because they use `contains`, but the status bar shows it verbatim, and at half
     * the screen's width it wraps to one character per line.
     */
    private fun readableState(raw: String): String =
        raw.substringBefore('@').substringAfterLast('$').ifBlank { raw }

    private fun bindCallbacks(controller: AvatarController?) {
        if (controller == null) return

        controller.onConnectionState = { state ->
            connectionState = readableState(state.toString().lowercase(Locale.US))
            // Matched against the extracted state name, not the raw string: "disconnected"
            // contains "connected", so a contains() check on the whole thing reads a
            // dropped connection as a live one — which is what closing the controller on
            // an avatar switch reports, leaving the Start button stuck on "Connected"
            // against a session that no longer exists.
            when (connectionState) {
                "connected" -> {
                    connectionReady.set(true)
                    connected = true
                    connecting = false
                }
                "connecting" -> connectionReady.set(false)
                else -> {
                    connectionReady.set(false)
                    connected = false
                    connecting = false
                    closeAgent()
                }
            }
        }

        controller.onConversationState = { state ->
            playback = when (state) {
                ConversationState.Playing -> PlaybackState.Playing
                ConversationState.Paused -> PlaybackState.Paused
                else -> PlaybackState.Idle
            }
        }

        controller.onError = { error ->
            val message = error.message ?: error.toString()
            sdkError = message
            showToast(message)
        }

        controller.frameRateMonitorEnabled = true
        controller.onFrameRateInfo = { info ->
            fps = info.fps.takeIf { it.isFinite() }?.toInt()
        }

        avatarView?.onFirstRendering = { rendered = true }
    }

    /** The six SDK callbacks the status bar reports, in the order they first fire. */
    private fun statusRows(): List<StatusRow> {
        if (characterId.isBlank()) return emptyList()
        return listOf(
            StatusRow(
                label = "Download",
                callback = "AvatarManager.load(id, onProgress)",
                help = "Model download progress, 0-100%. Only fires on a cache miss — a second load of the same avatar resolves straight away.",
                value = if (loading) "$loadProgress%" else "complete",
            ),
            StatusRow(
                label = "First frame",
                callback = "AvatarView.onFirstRendering",
                help = "Fires once, when the avatar has actually been drawn. This — not \"connected\" — is the moment to take a loading overlay down.",
                value = if (rendered) "rendered" else "waiting",
            ),
            StatusRow(
                label = "Connection",
                callback = "AvatarController.onConnectionState",
                help = "The Motion Server connection: disconnected → connecting → connected, or failed. Audio sent before connected is dropped.",
                value = connectionState,
            ),
            StatusRow(
                label = "Conversation",
                callback = "AvatarController.onConversationState",
                help = "Playback state: idle, playing or paused. The controls over the avatar follow this.",
                value = playback.name.lowercase(Locale.US),
            ),
            StatusRow(
                label = "Frame rate",
                callback = "AvatarController.onFrameRateInfo",
                help = "Rolling render rate over a 2-second window. Off by default and free while off; this demo enables it via frameRateMonitorEnabled.",
                value = fps?.let { "$it fps" },
            ),
            StatusRow(
                label = "Error",
                callback = "AvatarController.onError",
                help = "SDK failures — an expired session token, an unrecognised avatar id, a lost connection. Worth surfacing rather than leaving to the console.",
                value = sdkError ?: "none",
            ),
        )
    }

    private fun connect() {
        if (connected || connecting) return
        val controller = avatarView?.controller ?: return
        connecting = true
        lifecycleScope.launch {
            runCatching { controller.start() }
                .onFailure {
                    connecting = false
                    showToast("Failed to connect: ${it.message ?: it.javaClass.simpleName}")
                }
            // The state callback flips `connected`; this only bounds the wait.
            withTimeoutOrNull(15_000) {
                while (!connectionReady.get()) delay(100)
            }
            connecting = false
        }
    }

    private fun interrupt() {
        runCatching { avatarView?.controller?.interrupt() }
        realtime?.interrupt()
    }

    // ---------------------------------------------------------------- realtime

    private fun toggleMic() {
        if (!connectionReady.get()) {
            showToast("Tap Start to connect the avatar first.", ToastKind.Warning)
            return
        }
        if (micOn) {
            mic.stop()
            micOn = false
            return
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED
        ) {
            pendingMicStart = true
            micPermission.launch(Manifest.permission.RECORD_AUDIO)
            return
        }
        startMic()
    }

    private fun startMic() {
        lifecycleScope.launch {
            // The agent is brought up on the first press rather than on entry: it
            // costs a model session, and opening the app should not start one.
            if (!ensureAgent()) return@launch
            runCatching { mic.start(lifecycleScope) { chunk -> realtime?.pushMicAudio(chunk) } }
                .onSuccess { micOn = true }
                .onFailure { showToast(it.message ?: "Could not open the microphone") }
        }
    }

    private suspend fun ensureAgent(): Boolean {
        if (realtime?.isReady == true) return true
        val config = serverConfig ?: return false
        agentConnecting = true
        return try {
            val client = RealtimeClient(object : RealtimeClient.Callbacks {
                // `send` suspends, and these arrive on the WebSocket's own thread, so
                // each hop goes through the activity's scope rather than blocking it.
                override fun onAudio(pcm: ByteArray) {
                    // Straight to controller.send(). `end` stays false: a turn is
                    // many of these, and turn_end closes it.
                    lifecycleScope.launch {
                        runCatching { avatarView?.controller?.send(pcm, false) }
                    }
                }
                override fun onTurnEnd() {
                    // The empty final send is what tells the SDK the turn is over, so
                    // the avatar returns to idle rather than holding the last shape.
                    lifecycleScope.launch {
                        runCatching { avatarView?.controller?.send(ByteArray(0), true) }
                    }
                }
                override fun onInterrupt() {
                    runCatching { avatarView?.controller?.interrupt() }
                }
                override fun onTranscript(role: String, text: String) {
                    transcript = transcript + (role to text)
                }
                override fun onError(message: String) = showToast(message)
                override fun onClosed() {
                    agentReady = false
                    micOn = false
                }
            })
            // No settings travel with it: the language, the models and the voice
            // are the server's, fixed when it builds the agent session.
            client.connect(config.realtimeUrl)
            realtime = client
            agentReady = true
            true
        } catch (t: Throwable) {
            showToast(t.message ?: "Could not reach the agent")
            realtime?.close()
            realtime = null
            false
        } finally {
            agentConnecting = false
        }
    }

    private fun say(text: String) {
        if (text.isBlank()) return
        if (!connectionReady.get()) {
            showToast("Tap Start to connect the avatar first.", ToastKind.Warning)
            return
        }
        lifecycleScope.launch {
            if (!ensureAgent()) return@launch
            realtime?.say(text)
        }
    }

    private fun closeAgent() {
        mic.stop()
        micOn = false
        agentReady = false
        realtime?.close()
        realtime = null
    }

    // ---------------------------------------------------------------- plumbing

    private fun showToast(text: String, kind: ToastKind = ToastKind.Error) {
        toast = ToastMessage(text = text, kind = kind, serial = ++toastSerial)
    }

    override fun onDestroy() {
        super.onDestroy()
        closeAgent()
        val controller = avatarView?.controller
        runCatching { controller?.onConnectionState = null }
        runCatching { controller?.onConversationState = null }
        runCatching { controller?.onError = null }
        runCatching { controller?.close() }
        avatarView = null
    }
}
