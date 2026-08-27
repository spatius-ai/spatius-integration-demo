package ai.spatius.avatarkit.rtcmodedemo

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.TextButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import android.view.ViewGroup
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat

/**
 * The room: the avatar and the microphone.
 *
 * Thinner than the other two modes' playgrounds, and the reason is the mode itself: the
 * avatar is in the call, so there is nothing here that drives it. No clip list — there
 * is no pre-recorded scene. No pause, resume or interrupt — those act on local playback,
 * and there is none: the audio is a live RTC track. The Web client's room is the same
 * shape, for the same reason.
 */
@Composable
fun RoomScreen(
    session: AvatarRtcSession,
    baseUrl: String,
    language: Lang,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current

    var showCharacters by remember { mutableStateOf(false) }
    var selectedId by remember { mutableStateOf("") }

    val micPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted -> if (granted) session.publishMic() }

    LaunchedEffect(Unit) {
        session.start(baseUrl, if (language == Lang.Zh) "zh" else "en")
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("RTC Mode", style = MaterialTheme.typography.titleMedium)
            // A dialog rather than a list beside the avatar: a phone has no room for
            // both, and the avatar is what the screen is for.
            OutlinedButton(onClick = { showCharacters = true }) { Text("Avatar") }
        }

        // The stage. A fixed height rather than a square: as tall as the screen is wide
        // leaves the controls below it off screen on a phone.
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(300.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(Color.Black.copy(alpha = 0.05f)),
            contentAlignment = Alignment.Center,
        ) {
            session.avatarView?.let { view ->
                AndroidView(
                    // Detached first: the session owns this view and reuses it across
                    // recompositions, and adding one that still has a parent throws.
                    factory = { (view.parent as? ViewGroup)?.removeView(view); view },
                    modifier = Modifier.fillMaxSize(),
                )
            }

            if (!session.isReady) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    CircularProgressIndicator(modifier = Modifier.size(28.dp), strokeWidth = 3.dp)
                    Text(
                        session.status,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    session.downloadPercent?.let {
                        Text(
                            "$it%",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }

            // Nothing over the avatar here. The other two modes put pause and interrupt
            // there because they drive playback; in RTC Mode the avatar is in the call
            // and there is no local playback to act on — closing the microphone is the
            // only control, and it lives below.
        }

        // The microphone and nothing else, the same as the Web client: in RTC Mode
        // nothing is driven from this screen.
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(84.dp)
                    .clip(CircleShape)
                    .background(
                        when {
                            !session.agentReady -> MaterialTheme.colorScheme.outlineVariant
                            session.micActive -> Color(0xFFEF4444)
                            else -> MaterialTheme.colorScheme.primary
                        }
                    )
                    // The agent joins a beat after the channel connects. No ring marks
                    // the moment it comes alive, unlike the Web client: on a phone the
                    // button and the line of text under it are the whole screen, so the
                    // wording changing is already impossible to miss.
                    .clickable(enabled = session.agentReady) {
                        if (session.micActive) {
                            session.unpublishMic()
                        } else if (
                            ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO)
                            == PackageManager.PERMISSION_GRANTED
                        ) {
                            session.publishMic()
                        } else {
                            micPermission.launch(Manifest.permission.RECORD_AUDIO)
                        }
                    },
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    if (session.micActive) Icons.Filled.Stop else Icons.Filled.Mic,
                    contentDescription = if (session.micActive) "Stop" else "Talk",
                    tint = Color.White,
                    modifier = Modifier.size(30.dp),
                )
            }

            Text(
                text = when {
                    !session.isReady -> session.status
                    !session.agentReady -> "Waiting for the agent to join…"
                    session.micActive ->
                        "Listening — just talk, the agent decides when your turn ends."
                    else -> "Tap to start talking."
                },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )

            session.errorMessage?.let {
                Text(
                    it,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                    textAlign = TextAlign.Center,
                )
            }

            Spacer(Modifier.height(4.dp))
            Text(
                "RTC Mode is the one path where the avatar joins the call itself: audio "
                    + "travels on an RTC track and the motion rides along encoded in the "
                    + "video stream. Nothing is driven from this screen, and nothing "
                    + "streams through the server — it only issues the credentials to join.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }

    if (showCharacters) {
        AlertDialog(
            onDismissRequest = { showCharacters = false },
            title = { Text("Avatar") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    defaultCharacters.forEach { character ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(8.dp))
                                .clickable {
                                    showCharacters = false
                                    if (character.id != selectedId) {
                                        selectedId = character.id
                                        session.switchAvatar(character.id)
                                    }
                                }
                                .padding(10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            Text(character.name, style = MaterialTheme.typography.bodyMedium)
                            Spacer(Modifier.weight(1f))
                            if (character.id == selectedId) {
                                Icon(
                                    Icons.Filled.Check,
                                    contentDescription = null,
                                    tint = Color(0xFF22C55E),
                                    modifier = Modifier.size(18.dp),
                                )
                            }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { showCharacters = false }) { Text("Close") }
            },
        )
    }
}
