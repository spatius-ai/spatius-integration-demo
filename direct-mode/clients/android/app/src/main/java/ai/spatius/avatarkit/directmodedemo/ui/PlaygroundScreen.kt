package ai.spatius.avatarkit.directmodedemo.ui

import ai.spatius.avatarkit.AvatarView
import ai.spatius.avatarkit.directmodedemo.R
import ai.spatius.avatarkit.directmodedemo.audio.AUDIO_SOURCE_HINT
import ai.spatius.avatarkit.directmodedemo.audio.PCM_ASSETS
import ai.spatius.avatarkit.directmodedemo.audio.PcmAsset
import ai.spatius.avatarkit.directmodedemo.config.Scene
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView

/** What the avatar is doing, mirroring the SDK's ConversationState. */
enum class PlaybackState { Idle, Playing, Paused }

/**
 * One row of the status bar: an SDK callback and what it last reported.
 *
 * Listed whether or not this demo acts on the value — which hooks exist is part of
 * what a reference client is meant to show, and a row that only appears once it has
 * fired is a row nobody knows to expect. A value of `—` means "registered, nothing
 * reported yet".
 */
data class StatusRow(
    val label: String,
    val callback: String,
    val help: String,
    val value: String?,
)

/**
 * The playground, laid out for a phone.
 *
 * Same parts as the Web client and in the same order, folded into one column: the
 * avatar with its playback controls, then the status bar, then whatever drives the
 * avatar for this scene. What the Web version puts in a left-hand list — the
 * characters — is a dialog here, opened from the header; a phone has no room for a
 * permanent sidebar, and the avatar is what the screen is for.
 */
@Composable
fun PlaygroundScreen(
    scene: Scene,
    characterName: String,
    loading: Boolean,
    loadProgress: Int,
    rendered: Boolean,
    errorMsg: String,
    statusRows: List<StatusRow>,
    connected: Boolean,
    connecting: Boolean,
    playback: PlaybackState,
    sendingPath: String?,
    canCreateAvatarView: Boolean,
    micOn: Boolean,
    agentConnecting: Boolean,
    agentReady: Boolean,
    transcript: List<Pair<String, String>>,
    onPickCharacter: () -> Unit,
    onStart: () -> Unit,
    onSendPcm: (PcmAsset) -> Unit,
    onInterrupt: () -> Unit,
    onPause: () -> Unit,
    onResume: () -> Unit,
    onToggleMic: () -> Unit,
    onSay: (String) -> Unit,
    onAvatarViewCreated: (AvatarView) -> Unit,
) {

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(DS.bg)
    ) {
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 14.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.Bottom,
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(
                            text = "SPATIUS DIRECT MODE",
                            color = DS.kicker,
                            fontSize = 10.sp,
                            fontFamily = FontFamily.Monospace,
                            fontWeight = FontWeight.SemiBold,
                        )
                        Text(
                            text = characterName.ifBlank { "Avatar Demo" },
                            color = DS.title,
                            style = MaterialTheme.typography.headlineSmall,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                    // Stands in for the Web client's character list.
                    OutlinedButton(onClick = onPickCharacter, enabled = !loading) {
                        Text("Characters", fontSize = 12.sp)
                    }
                }
            }

            // ---- The avatar, with the playback controls over it.
            item {
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .border(1.dp, DS.panelBorder, RoundedCornerShape(14.dp)),
                    shape = RoundedCornerShape(14.dp),
                    colors = CardDefaults.cardColors(containerColor = DS.panel),
                    elevation = CardDefaults.cardElevation(defaultElevation = 6.dp),
                ) {
                    Box(modifier = Modifier.fillMaxWidth().padding(10.dp)) {
                        StageViewport(
                            characterName = characterName,
                            loading = loading,
                            loadProgress = loadProgress,
                            rendered = rendered,
                            errorMsg = errorMsg,
                            canCreateAvatarView = canCreateAvatarView,
                            onAvatarViewCreated = onAvatarViewCreated,
                        )

                        // Over the avatar, since that is what they act on. Which pair
                        // shows follows the playback state; in idle neither does.
                        //
                        // Pinned to the two bottom corners rather than centred as a
                        // pair: the avatar's face is in the middle, and a row of
                        // buttons across it is the one place they cannot go. Interrupt
                        // keeps the left corner in both states — it does the same thing
                        // either way, and moving it would make the two swap places on
                        // every pause.
                        if (playback != PlaybackState.Idle) {
                            Row(
                                modifier = Modifier
                                    .align(Alignment.BottomCenter)
                                    .fillMaxWidth()
                                    .padding(horizontal = 20.dp, vertical = 16.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                            ) {
                                StageButton(Icons.Filled.Stop, "Interrupt", DS.chipErrFg, onInterrupt)
                                if (playback == PlaybackState.Paused) {
                                    StageButton(Icons.Filled.PlayArrow, "Resume", DS.blue, onResume)
                                } else {
                                    StageButton(Icons.Filled.Pause, "Pause", DS.blue, onPause)
                                }
                            }
                        }
                    }
                }
            }

            // ---- Start. Above the status bar: connecting is the first thing to do
            //      once a character is loaded, and the status below reports whether it
            //      worked. Pulsed until pressed, for the same reason the character
            //      button is — with an avatar on screen but no session, sending audio
            //      silently does nothing.
            if (rendered) {
                item {
                    Button(
                        onClick = onStart,
                        enabled = !connected && !connecting,
                        // No ring around it, unlike the Web client: on a phone this
                        // button is full width with nothing competing for attention, so
                        // marking it as the thing to press adds nothing.
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.buttonColors(containerColor = DS.blue),
                    ) {
                        Text(
                            text = when {
                                connected -> "Connected"
                                connecting -> "Connecting…"
                                else -> "Start"
                            },
                            fontWeight = FontWeight.Bold,
                        )
                    }
                }
            }

            // ---- The SDK callbacks and the clips that drive the avatar.
            //
            // Side by side in the pre-recorded scene, each scrolling in its own column:
            // the clips are what gets tapped and the status is what gets read while the
            // avatar answers, and stacked they do not fit on one screen — every clip
            // meant scrolling down to tap and back up to watch. The realtime scene has
            // no clip list, so the status keeps the full width there.
            val clipsBeside = rendered && scene == Scene.Sample
            if (statusRows.isNotEmpty() || clipsBeside) {
                item {
                    if (clipsBeside) {
                        Row(
                            modifier = Modifier.fillMaxWidth().height(240.dp),
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            Box(modifier = Modifier.weight(1f).fillMaxHeight()) {
                                StatusCard(statusRows = statusRows, bounded = true)
                            }
                            Box(modifier = Modifier.weight(1f).fillMaxHeight()) {
                                ClipsCard(sendingPath = sendingPath, onSendPcm = onSendPcm)
                            }
                        }
                    } else if (statusRows.isNotEmpty()) {
                        StatusCard(statusRows = statusRows, bounded = false)
                    }
                }
            }

            if (rendered && scene == Scene.Realtime) {
                item {
                    RealtimePanel(
                        connected = connected,
                        micOn = micOn,
                        agentConnecting = agentConnecting,
                        agentReady = agentReady,
                        transcript = transcript,
                        onToggleMic = onToggleMic,
                        onSay = onSay,
                    )
                }
            }
        }

    }
}

/** The realtime scene's controls: one microphone, in place of the clip list. */
@Composable
private fun RealtimePanel(
    connected: Boolean,
    micOn: Boolean,
    agentConnecting: Boolean,
    agentReady: Boolean,
    transcript: List<Pair<String, String>>,
    onToggleMic: () -> Unit,
    onSay: (String) -> Unit,
) {
    var typed by remember { mutableStateOf("") }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .border(1.dp, DS.panelBorder, RoundedCornerShape(14.dp)),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = DS.panel),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                "Microphone",
                color = DS.title,
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.fillMaxWidth(),
            )

            // Ringed until it has been used once, the same hint the character button
            // and Start carry. Not `!micOn`, or the ring would return on every mute.
            Button(
                onClick = onToggleMic,
                enabled = !agentConnecting,
                shape = RoundedCornerShape(999.dp),
                // No ring here either — see the Start button above.
                modifier = Modifier.size(84.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = if (micOn) Color(0xFFEF4444) else DS.blue,
                    contentColor = Color.White,
                ),
            ) {
                Text(if (micOn) "◼" else "🎤", fontSize = 22.sp)
            }

            Text(
                text = when {
                    agentConnecting -> "Starting the agent…"
                    micOn -> "Listening — just talk, the agent decides when your turn ends."
                    agentReady -> "Microphone off."
                    else -> "Tap to start talking."
                },
                color = DS.muted,
                style = MaterialTheme.typography.bodySmall,
            )

            // A way to try the scene without a microphone — a device with no input, or
            // a quick check that the agent replies.
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                OutlinedTextField(
                    value = typed,
                    onValueChange = { typed = it },
                    singleLine = true,
                    placeholder = { Text("…or type a line to speak", color = DS.muted, fontSize = 12.sp) },
                    modifier = Modifier.weight(1f),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = DS.blue,
                        unfocusedBorderColor = DS.panelBorder,
                    ),
                )
                OutlinedButton(
                    onClick = { onSay(typed.trim()); typed = "" },
                    enabled = typed.isNotBlank(),
                ) { Text("Say", fontSize = 12.sp) }
            }

            if (transcript.isNotEmpty()) {
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    transcript.forEach { (role, text) ->
                        Text(
                            text = "${if (role == "user") "You" else "Avatar"}  $text",
                            color = if (role == "user") DS.text else DS.blue,
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
            }

            Text(
                text = "The conversation runs on the backend — ASR, LLM and TTS — and its " +
                    "speech arrives here as PCM over a WebSocket. That audio goes to " +
                    "controller.send(), exactly like the pre-recorded clips do.",
                color = DS.muted,
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

/**
 * The SDK callbacks, one row each.
 *
 * Scrolls within itself: beside the clip list it gets half the width and a fixed
 * height, and these rows are worth reading while the avatar answers rather than being
 * cut off.
 */
@Composable
private fun StatusCard(
    statusRows: List<StatusRow>,
    /**
     * Whether this card sits in a row of a fixed height, beside the clip list.
     *
     * It decides whether the rows scroll inside the card. Scrolling needs a bounded
     * height, and on its own in the LazyColumn this card has none — the list hands its
     * items unbounded height, and a scroller given that throws rather than guessing. So
     * beside the clips it scrolls within its 240dp; alone it is as tall as its rows and
     * the page scrolls instead.
     */
    bounded: Boolean,
) {
    Card(
        modifier = if (bounded) Modifier.fillMaxSize() else Modifier.fillMaxWidth()
            .border(1.dp, DS.panelBorder, RoundedCornerShape(14.dp)),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = DS.panel),
    ) {
        Column(
            modifier = Modifier
                .then(
                    if (bounded) {
                        Modifier.fillMaxSize().verticalScroll(rememberScrollState())
                    } else Modifier.fillMaxWidth()
                )
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            statusRows.forEach { row ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    // One line per row, like the other clients: the callback's name
                    // is documentation, not status, and a second line of it doubles
                    // the height of a panel that has to fit beside the controls.
                    //
                    // Both sides get a weight so neither can starve the other: at half
                    // the screen's width an unconstrained value pushes the label out
                    // and then wraps to one character per line.
                    Text(
                        row.label,
                        color = DS.text,
                        fontSize = 12.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    Text(
                        text = row.value ?: "\u2014",
                        color = if (row.label == "Error" && row.value != null && row.value != "none") {
                            DS.chipErrFg
                        } else if (row.value == null) DS.muted else DS.text,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        textAlign = TextAlign.End,
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }
    }
}

/**
 * The clips this scene can send. Scrolls within itself, for the same reason as
 * [StatusCard].
 */
@Composable
private fun ClipsCard(
    sendingPath: String?,
    onSendPcm: (PcmAsset) -> Unit,
) {
    Card(
        modifier = Modifier
            .fillMaxSize()
            .border(1.dp, DS.panelBorder, RoundedCornerShape(14.dp)),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = DS.panel),
    ) {
        Column(
            // Always bounded: this card only ever appears inside the fixed-height row
            // beside the status card, which is what makes scrolling here legal.
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text("Audio Files", color = DS.title, fontSize = 13.sp, fontWeight = FontWeight.Bold)
            PCM_ASSETS.forEach { asset ->
                val isSending = sendingPath == asset.path
                OutlinedButton(
                    onClick = { onSendPcm(asset) },
                    enabled = sendingPath == null,
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.outlinedButtonColors(
                        containerColor = if (isSending) DS.blue else Color.Transparent,
                        contentColor = if (isSending) Color.White else DS.text,
                    ),
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
                ) {
                    Text(
                        text = if (isSending) "..." else "\u25b6 ${asset.name}",
                        fontSize = 11.sp,
                        maxLines = 1,
                    )
                }
            }
            // Plain text under the list rather than behind a tappable "?": one short
            // line is cheaper to read than a dialog is to open and dismiss.
            Text(
                AUDIO_SOURCE_HINT,
                color = DS.muted,
                fontSize = 9.sp,
                lineHeight = 12.sp,
            )
        }
    }
}

/**
 * One of the two controls over the avatar.
 *
 * An icon rather than a word: these sit on top of the render, where a label wide enough
 * to read is a label wide enough to cover the picture. The colour is the button rather
 * than a tint over the render, and the white ring is what keeps it readable against a
 * light avatar and a dark background alike.
 */
@Composable
private fun StageButton(
    icon: ImageVector,
    description: String,
    color: Color,
    onClick: () -> Unit,
) {
    Box(
        modifier = Modifier
            .size(56.dp)
            .shadow(8.dp, CircleShape)
            .clip(CircleShape)
            .background(color)
            .border(3.dp, Color.White.copy(alpha = 0.85f), CircleShape)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = description, tint = Color.White, modifier = Modifier.size(24.dp))
    }
}

@Composable
private fun StageViewport(
    characterName: String,
    loading: Boolean,
    loadProgress: Int,
    rendered: Boolean,
    errorMsg: String,
    canCreateAvatarView: Boolean,
    onAvatarViewCreated: (AvatarView) -> Unit,
) {
    val context = LocalContext.current

    Box(
        modifier = Modifier
            .fillMaxWidth()
            // A fixed height, not a square: aspectRatio(1f) makes the stage as tall as
            // the screen is wide, which on a phone leaves the status bar below it half
            // off screen and the microphone under that entirely. 300dp matches the iOS
            // client, where everything fits without scrolling.
            .height(300.dp)
            .clip(RoundedCornerShape(10.dp))
    ) {
        Image(
            painter = painterResource(id = R.drawable.avatar_bg),
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxSize(),
        )
        Box(modifier = Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.08f)))

        if (canCreateAvatarView) {
            AndroidView(
                factory = {
                    AvatarView(context).also {
                        it.setBackgroundColor(android.graphics.Color.TRANSPARENT)
                        runCatching {
                            val method = it.javaClass.getMethod("setOpaque", java.lang.Boolean::class.java)
                            method.invoke(it, false)
                        }
                        onAvatarViewCreated(it)
                    }
                },
                modifier = Modifier.fillMaxSize(),
            )
        }

        // The first rendered frame is what takes the overlay down — not "connected",
        // which happens later and would leave a blank canvas showing.
        if (!rendered) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = 0.22f)),
                contentAlignment = Alignment.Center,
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    when {
                        errorMsg.isNotBlank() -> Text(
                            text = errorMsg,
                            color = Color.White,
                            style = MaterialTheme.typography.bodySmall,
                            modifier = Modifier.padding(horizontal = 20.dp),
                        )
                        loading -> {
                            CircularProgressIndicator(
                                modifier = Modifier.height(22.dp),
                                color = Color.White,
                                strokeWidth = 2.dp,
                            )
                            Text(
                                text = if (loadProgress > 0) "Downloading avatar… $loadProgress%"
                                else "Loading avatar…",
                                color = Color.White,
                                style = MaterialTheme.typography.bodyMedium,
                            )
                        }
                        characterName.isBlank() -> Text(
                            text = "Pick a character to get started",
                            color = Color.White,
                            style = MaterialTheme.typography.bodyMedium,
                        )
                        else -> Text(
                            text = "Waiting for the first frame…",
                            color = Color.White,
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    }
                }
            }
        }
    }
}
