package ai.spatius.avatarkit.backendmodedemo

import ai.spatius.avatarkit.AvatarView
import android.Manifest
import ai.spatius.avatarkit.player.AnimationPlayer
import ai.spatius.avatarkit.backendmodedemo.data.defaultCharacters
import ai.spatius.avatarkit.backendmodedemo.ui.CharacterPicker
import ai.spatius.avatarkit.backendmodedemo.ui.screens.BootScreen
import ai.spatius.avatarkit.backendmodedemo.ui.screens.PlaybackState
import ai.spatius.avatarkit.backendmodedemo.ui.screens.PlaygroundScreen
import ai.spatius.avatarkit.backendmodedemo.ui.screens.StatusRow
import java.util.Locale
import ai.spatius.avatarkit.backendmodedemo.ui.theme.AvatarKitBackendModeDemoTheme
import ai.spatius.avatarkit.backendmodedemo.viewmodel.AvatarViewModel
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier

/**
 * The app opens on the playground.
 *
 * There is no configuration screen: in Backend Mode the server holds the Motion
 * Server connection and every credential with it, and its address is fixed at build
 * time from `local.properties`. So the only startup work is reading `/api/config`
 * and initializing the SDK with what comes back — [AvatarViewModel.boot].
 */
class MainActivity : ComponentActivity() {

    private val viewModel: AvatarViewModel by viewModels()

    private var characterName by mutableStateOf("")
    private var showPicker by mutableStateOf(false)

    /** Set while the permission prompt is up, so the tap can resume after it. */
    private var pendingMicStart = false

    private val micPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted && pendingMicStart) viewModel.backendStartMic()
        pendingMicStart = false
    }

    /**
     * The SDK callbacks worth watching, in the order they first fire.
     *
     * There is no connection row: in Backend Mode the server holds the Motion Server
     * connection, so `onConnectionState` never fires on this side.
     */
    private fun statusRows(): List<StatusRow> {
        if (viewModel.currentAvatarId.isBlank()) return emptyList()
        return listOf(
            StatusRow(
                label = "Download",
                callback = "AvatarManager.load(id, onProgress)",
                help = "Model download progress, 0-100%. Only fires on a cache miss.",
                value = if (viewModel.isLoading) {
                    "${(viewModel.loadProgress * 100).toInt()}%"
                } else "complete",
            ),
            StatusRow(
                label = "First frame",
                callback = "AvatarView.onFirstRendering",
                help = "Fires once, when the avatar has actually been drawn.",
                value = if (viewModel.rendered) "rendered" else "waiting",
            ),
            StatusRow(
                label = "Server",
                callback = "WebSocket /ws/agent",
                help = "The connection this app renders from. The server holds the Motion Server one.",
                value = when {
                    viewModel.backendConnected -> "connected"
                    viewModel.backendConnecting -> "connecting"
                    else -> "disconnected"
                },
            ),
            StatusRow(
                label = "Conversation",
                callback = "AvatarController.onConversationState",
                help = "Playback state: idle, playing or paused.",
                value = viewModel.conversationState.toString()
                    .substringBefore('@').substringAfterLast('$').lowercase(Locale.US),
            ),
            StatusRow(
                label = "Frame rate",
                callback = "AvatarController.onFrameRateInfo",
                help = "Rolling render rate over a 2-second window.",
                value = viewModel.fps?.let { "$it fps" },
            ),
            StatusRow(
                label = "Error",
                callback = "AvatarController.onError",
                help = "SDK failures worth surfacing rather than leaving to the log.",
                value = viewModel.errorState?.message ?: "none",
            ),
        )
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            AvatarKitBackendModeDemoTheme {
                Scaffold(modifier = Modifier.fillMaxSize()) { innerPadding ->
                    val content = Modifier.padding(innerPadding)

                    LaunchedEffect(Unit) { viewModel.boot() }

                    if (!viewModel.ready) {
                        BootScreen(
                            error = viewModel.bootError,
                            onRetry = { viewModel.boot() },
                            modifier = content,
                        )
                        return@Scaffold
                    }

                    PlaygroundScreen(
                        characterName = characterName,
                        loading = viewModel.isLoading,
                        loadProgress = (viewModel.loadProgress * 100).toInt(),
                        rendered = viewModel.rendered,
                        errorMsg = viewModel.errorState?.message.orEmpty(),
                        statusRows = statusRows(),
                        // The server owns the Motion Server connection, so what
                        // "connected" means here is the WebSocket to it.
                        connected = viewModel.backendConnected,
                        playback = when {
                            viewModel.isPaused -> PlaybackState.Paused
                            viewModel.conversationState ==
                                AnimationPlayer.ConversationState.Playing -> PlaybackState.Playing
                            else -> PlaybackState.Idle
                        },
                        canCreateAvatarView = viewModel.currentAvatarId.isNotEmpty(),
                        micOn = viewModel.backendMicActive,
                        agentConnecting = viewModel.agentConnecting,
                        agentReady = viewModel.agentReady,
                        transcript = viewModel.transcript,
                        onPickCharacter = { showPicker = true },
                        onInterrupt = { viewModel.interrupt() },
                        onPause = { viewModel.pause() },
                        onResume = { viewModel.resume() },
                        onToggleMic = {
                            when {
                                viewModel.backendMicActive -> viewModel.backendStopMic()
                                // Asked for here rather than swallowed in the
                                // view model: without a prompt the first tap
                                // does nothing at all, with no way to tell why.
                                viewModel.hasRecordPermission() ->
                                    viewModel.backendStartMic()
                                else -> {
                                    pendingMicStart = true
                                    micPermission.launch(Manifest.permission.RECORD_AUDIO)
                                }
                            }
                        },
                        onSay = { viewModel.backendSendText(it) },
                        onAvatarViewCreated = { view: AvatarView ->
                            viewModel.onAvatarViewCreated(view)
                            // Whatever the server nominates, loaded as soon as
                            // there is something to draw it into — so the
                            // playground is never empty on arrival.
                            if (viewModel.currentAvatarId.isBlank() &&
                                viewModel.configuredAvatarId.isNotBlank()
                            ) {
                                characterName = defaultCharacters
                                    .firstOrNull { it.id == viewModel.configuredAvatarId }
                                    ?.name.orEmpty()
                                viewModel.loadInitialAvatar(viewModel.configuredAvatarId)
                            }
                        },
                        modifier = content,
                    )

                    if (showPicker) {
                        CharacterPicker(
                            selectedId = viewModel.currentAvatarId,
                            loading = viewModel.isLoading,
                            onSelect = { id, name ->
                                showPicker = false
                                characterName = name
                                viewModel.loadAvatar(id)
                            },
                            onDismiss = { showPicker = false },
                        )
                    }
                }
            }
        }
    }
}
