package ai.spatius.avatarkit.directmodedemo.ui

import ai.spatius.avatarkit.directmodedemo.R
import ai.spatius.avatarkit.directmodedemo.config.BackendClient
import ai.spatius.avatarkit.directmodedemo.config.Lang
import ai.spatius.avatarkit.directmodedemo.config.Scene
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private const val DASH_URL = "https://app.spatius.ai"
private const val LIVEKIT_URL = "https://cloud.livekit.io"

/**
 * The configuration screen.
 *
 * Credentials are shown, never typed. Copying five secrets across apps on a phone is
 * miserable, and the IME mangles them — auto-capitalization and autocorrect leave
 * damage that is invisible afterwards. They belong in the server's `.env`, which the
 * user is already sitting in front of, and one copy there covers every client.
 *
 * So the only field here is the server's address: a phone cannot reach the dev
 * machine's localhost, and the server prints its LAN address on startup.
 */
@Composable
fun ConfigurationScreen(
    baseUrl: String,
    scene: Scene,
    language: Lang,
    serverConfig: BackendClient.ServerConfig?,
    checking: Boolean,
    statusText: String,
    errorMsg: String,
    onBaseUrlChange: (String) -> Unit,
    onSceneChange: (Scene) -> Unit,
    onLanguageChange: (Lang) -> Unit,
    onCheckConnection: () -> Unit,
    onStart: () -> Unit,
) {
    val context = LocalContext.current
    val isRealtime = scene == Scene.Realtime

    // Which credentials this scene still needs, as the server reports them. The
    // sample-audio scene needs only the Spatius pair, so it can run while the
    // realtime one is still unconfigured.
    val missing = when {
        serverConfig == null -> emptyList()
        isRealtime -> serverConfig.missingRealtime
        else -> serverConfig.missingSample
    }
    val ready = serverConfig != null && missing.isEmpty()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(DS.bg),
    ) {
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 20.dp, vertical = 24.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            item {
                Text(
                    text = "AvatarKit Direct Mode Demo",
                    color = DS.title,
                    fontWeight = FontWeight.Bold,
                    style = MaterialTheme.typography.titleLarge,
                )
            }
            item {
                Text(
                    text = "The client drives the avatar directly. Pick where its audio comes from.",
                    color = DS.muted,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }

            // The scene goes first: it decides which credentials are required below.
            item {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(
                        text = "Scene",
                        color = DS.text,
                        fontWeight = FontWeight.SemiBold,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        SceneCard(
                            title = "Pre-recorded audio",
                            subtitle = "Play a bundled clip",
                            selected = !isRealtime,
                            modifier = Modifier.weight(1f),
                        ) { onSceneChange(Scene.Sample) }
                        SceneCard(
                            title = "Realtime audio",
                            subtitle = "Talk to the avatar",
                            selected = isRealtime,
                            modifier = Modifier.weight(1f),
                        ) { onSceneChange(Scene.Realtime) }
                    }
                }
            }

            // The server's address. The one thing that cannot come from the server
            // itself, since this is how the phone finds it.
            item {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(
                        text = "Server address",
                        color = DS.text,
                        fontWeight = FontWeight.SemiBold,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    OutlinedTextField(
                        value = baseUrl,
                        onValueChange = onBaseUrlChange,
                        singleLine = true,
                        placeholder = { Text("http://192.168.x.x:8090", color = DS.muted, fontSize = 13.sp) },
                        keyboardOptions = KeyboardOptions(
                            keyboardType = KeyboardType.Uri,
                            capitalization = KeyboardCapitalization.None,
                        ),
                        modifier = Modifier.fillMaxWidth(),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = DS.blue,
                            unfocusedBorderColor = DS.panelBorder,
                        ),
                    )
                    Text(
                        text = "The server prints this on startup. Use 10.0.2.2 on the emulator, " +
                            "the LAN address on a real device.",
                        color = DS.muted,
                        style = MaterialTheme.typography.bodySmall,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = onCheckConnection, enabled = !checking) {
                            Text(if (checking) "Checking…" else "Check connection", fontSize = 12.sp)
                        }
                    }
                    if (statusText.isNotBlank()) {
                        Text(statusText, color = DS.muted, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }

            // Credentials, shown but not editable — see the note on this screen.
            item {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(
                        text = "Credentials",
                        color = DS.text,
                        fontWeight = FontWeight.SemiBold,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    if (serverConfig == null) {
                        Text(
                            text = "Check the connection to read what the server has.",
                            color = DS.muted,
                            style = MaterialTheme.typography.bodySmall,
                        )
                    } else {
                        val required = if (isRealtime) RealtimeKeys else SampleKeys
                        required.forEach { key ->
                            CredentialRow(key = key, filled = key !in missing)
                        }
                        Text(
                            text = "Set these in the server's .env — they never reach this device. " +
                                "Editing them there covers every client at once.",
                            color = DS.muted,
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
            }

            // Only the realtime scene reaches an agent, so this appears with it.
            //
            // Chosen here rather than inside the scene: recognition, synthesis and the
            // persona are all fixed when the agent session is built, so it cannot be
            // switched on a running conversation.
            if (isRealtime) {
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(
                            text = "Conversation language",
                            color = DS.text,
                            fontWeight = FontWeight.SemiBold,
                            style = MaterialTheme.typography.bodyMedium,
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            listOf(Lang.En to "English", Lang.Zh to "中文").forEach { (value, label) ->
                                val selected = language == value
                                OutlinedButton(
                                    onClick = { onLanguageChange(value) },
                                    colors = ButtonDefaults.outlinedButtonColors(
                                        containerColor = if (selected) DS.blue else Color.Transparent,
                                        contentColor = if (selected) Color.White else DS.text,
                                    ),
                                ) { Text(label, fontSize = 12.sp) }
                            }
                        }
                        Text(
                            text = "Sets speech recognition, the voice, and the assistant's persona.",
                            color = DS.muted,
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
            }

            if (errorMsg.isNotBlank()) {
                item {
                    Text(
                        text = errorMsg,
                        color = DS.chipErrFg,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .background(DS.logErrBg)
                            .padding(10.dp),
                    )
                }
            }

            item {
                Button(
                    onClick = onStart,
                    enabled = ready && !checking,
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(containerColor = DS.blue),
                ) {
                    Text(text = "Start", fontWeight = FontWeight.Bold)
                }
                if (serverConfig != null && missing.isNotEmpty()) {
                    Text(
                        text = "Fill in ${missing.joinToString(", ")} in the server's .env first.",
                        color = DS.muted,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                    )
                }
            }

            item {
                TextButton(onClick = {
                    runCatching {
                        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(DASH_URL)))
                    }
                }) { Text("Where to find your App ID and API Key", color = DS.blue, fontSize = 12.sp) }
            }

            item {
                Image(
                    painter = painterResource(id = R.drawable.api_key_guide),
                    contentDescription = "Where to find your App ID and API Key",
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .clickable {
                            runCatching {
                                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(DASH_URL)))
                            }
                        },
                )
            }

            if (isRealtime) {
                item {
                    TextButton(onClick = {
                        runCatching {
                            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(LIVEKIT_URL)))
                        }
                    }) { Text("Where to find your LiveKit keys", color = DS.blue, fontSize = 12.sp) }
                }

                // Two steps: open Settings, then look at API keys. The realtime scene
                // is the only one that needs LiveKit, so these appear with it.
                items(listOf(R.drawable.livekit_guide_1, R.drawable.livekit_guide_2)) { guide ->
                    Image(
                        painter = painterResource(id = guide),
                        contentDescription = "Where to find your LiveKit keys",
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(10.dp))
                            .clickable {
                                runCatching {
                                    context.startActivity(
                                        Intent(Intent.ACTION_VIEW, Uri.parse(LIVEKIT_URL))
                                    )
                                }
                            },
                    )
                }
            }
        }
    }
}

/** The credentials each scene needs, named as they appear in the server's `.env`. */
private val SampleKeys = listOf("SPATIUS_API_KEY", "SPATIUS_APP_ID")
private val RealtimeKeys = SampleKeys + listOf(
    "LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET",
)

@Composable
private fun CredentialRow(key: String, filled: Boolean) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(key, color = DS.text, style = MaterialTheme.typography.bodySmall)
        Text(
            text = if (filled) "configured" else "missing",
            color = if (filled) DS.chipOkFg else DS.chipErrFg,
            style = MaterialTheme.typography.bodySmall,
            fontWeight = FontWeight.Medium,
        )
    }
}

@Composable
private fun SceneCard(
    title: String,
    subtitle: String,
    selected: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(10.dp))
            .background(if (selected) DS.blue.copy(alpha = 0.10f) else Color.Transparent)
            .border(
                width = if (selected) 2.dp else 1.dp,
                color = if (selected) DS.blue else DS.panelBorder,
                shape = RoundedCornerShape(10.dp),
            )
            .clickable(onClick = onClick)
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(title, color = DS.title, fontSize = 13.sp, fontWeight = FontWeight.Bold)
        Text(subtitle, color = DS.muted, fontSize = 11.sp)
    }
}
