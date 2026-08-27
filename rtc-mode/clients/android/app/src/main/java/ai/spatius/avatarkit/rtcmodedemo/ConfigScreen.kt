package ai.spatius.avatarkit.rtcmodedemo

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp

private const val DASH_URL = "https://app.spatius.ai"
private const val AGORA_URL = "https://console.agora.io"

/** Which language the conversation runs in. */
enum class Lang { En, Zh }

/** Where the server is, and which language was picked. Credentials are never here. */
private object ConfigStore {
    private const val PREFS = "avatarkit-rtc-demo-config"
    private const val KEY_BASE_URL = "baseUrl"
    private const val KEY_LANGUAGE = "language"

    fun baseUrl(context: Context): String =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_BASE_URL, null)?.takeIf { it.isNotBlank() }
            ?: BuildConfig.RTC_MODE_URL

    fun language(context: Context): Lang =
        if (context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(KEY_LANGUAGE, null) == "zh"
        ) Lang.Zh else Lang.En

    fun save(context: Context, baseUrl: String, language: Lang) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_BASE_URL, baseUrl)
            .putString(KEY_LANGUAGE, if (language == Lang.Zh) "zh" else "en")
            .apply()
    }
}

/**
 * The configuration screen.
 *
 * Credentials are shown, never typed. Copying secrets across apps on a phone is
 * miserable, and the IME mangles them — auto-capitalization and autocorrect leave
 * damage that is invisible afterwards. They belong in the server's `.env`, which the
 * user is already sitting in front of, and one copy there covers every client.
 *
 * So the only field here is the server's address: a phone cannot reach the dev
 * machine's localhost, and the server prints its LAN address on startup.
 *
 * There is one scene, unlike the other two modes: in RTC Mode the avatar joins the call
 * itself and everything it says arrives over the channel — there is no pre-recorded
 * path to choose.
 */
@Composable
fun ConfigScreen(
    onReady: (baseUrl: String, language: Lang) -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current

    var baseUrl by remember { mutableStateOf(ConfigStore.baseUrl(context)) }
    var language by remember { mutableStateOf(ConfigStore.language(context)) }
    var config by remember { mutableStateOf<ServerConfig?>(null) }
    var checking by remember { mutableStateOf(true) }
    var statusText by remember { mutableStateOf("") }
    var checkTrigger by remember { mutableStateOf(0) }

    // Persisted as they change, not once a session succeeds: the address is what makes
    // the server reachable in the first place, so a failed Start is exactly when it must
    // not be lost — otherwise every retry begins by typing an IP address on a phone
    // keyboard again.
    fun persist() = ConfigStore.save(context, baseUrl, language)

    /**
     * The credentials this mode needs, named as they appear in the server's `.env`.
     *
     * Agora rather than LiveKit, and not a choice: the Android RTC SDK ships the Agora
     * stack alone, so this app asks the server for an Agora session whatever its own
     * `TRANSPORT` is set to. The Web clients can switch; this one cannot.
     */
    val requiredKeys = listOf(
        "SPATIUS_APP_ID",
        "SPATIUS_API_KEY",
        "AGORA_APP_ID",
        "AGORA_APP_CERTIFICATE",
        "AGORA_PIPELINE_ID",
    )

    LaunchedEffect(checkTrigger) {
        if (baseUrl.isBlank()) {
            config = null
            statusText = "No server address"
            checking = false
            return@LaunchedEffect
        }
        checking = true
        statusText = "Checking…"
        runCatching { AgentClient.fetchConfig(baseUrl) }
            .onSuccess { config = it; statusText = "Server online." }
            .onFailure { config = null; statusText = it.message ?: it.javaClass.simpleName }
        checking = false
    }

    val missing = config?.missingAgora ?: emptyList()
    val ready = config != null && missing.isEmpty() && !checking

    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(24.dp)
            .verticalScroll(rememberScrollState()),
    ) {
        Text("AvatarKit RTC Mode Demo", style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(4.dp))
        Text(
            "The avatar joins the call itself — audio and motion both arrive over RTC, "
                + "and nothing streams through the server.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        // The server's address. The one thing that cannot come from the server itself,
        // since this is how the phone finds it.
        Spacer(Modifier.height(20.dp))
        Text("Server address", style = MaterialTheme.typography.titleSmall)
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = baseUrl,
            onValueChange = { baseUrl = it; persist() },
            singleLine = true,
            placeholder = { Text("http://192.168.x.x:8790") },
            keyboardOptions = KeyboardOptions(
                keyboardType = KeyboardType.Uri,
                capitalization = KeyboardCapitalization.None,
            ),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(4.dp))
        Text(
            "The server prints this on startup. Use 10.0.2.2 on the emulator, the LAN "
                + "address on a real device.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(8.dp))
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            OutlinedButton(onClick = { checkTrigger++ }, enabled = !checking) {
                Text(if (checking) "Checking…" else "Check connection")
            }
            if (statusText.isNotBlank()) {
                Text(
                    statusText,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        // Chosen here rather than inside the room: recognition, the voice and the
        // persona are all fixed when the agent session is built, so none of them can be
        // switched on a running conversation.
        Spacer(Modifier.height(20.dp))
        Text("Conversation language", style = MaterialTheme.typography.titleSmall)
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            LangCard("English", language == Lang.En, Modifier.weight(1f)) {
                language = Lang.En; persist()
            }
            LangCard("中文", language == Lang.Zh, Modifier.weight(1f)) {
                language = Lang.Zh; persist()
            }
        }
        Spacer(Modifier.height(4.dp))
        Text(
            "Sets speech recognition and the assistant's persona. The voice comes from "
                + "the agent published in the Agora console.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        HorizontalDivider(modifier = Modifier.padding(vertical = 20.dp))

        // Credentials, shown but not editable — see the note on this screen.
        Text("Credentials", style = MaterialTheme.typography.titleSmall)
        Spacer(Modifier.height(8.dp))
        if (checking) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                Text("Checking server…", style = MaterialTheme.typography.bodySmall)
            }
        } else if (config == null) {
            Text(
                "Check the connection to read what the server has.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            requiredKeys.forEach { key ->
                val filled = !missing.contains(key)
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text(
                        key,
                        style = MaterialTheme.typography.bodySmall
                            .copy(fontFamily = FontFamily.Monospace),
                    )
                    Text(
                        if (filled) "configured" else "missing",
                        style = MaterialTheme.typography.bodySmall,
                        color = if (filled) Color(0xFF22C55E) else MaterialTheme.colorScheme.error,
                    )
                }
            }
            Spacer(Modifier.height(6.dp))
            Text(
                "Set these in the server's .env — they never reach this device. The "
                    + "server signs the token this app joins with, and starts the agent "
                    + "that brings the avatar into the channel.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        Spacer(Modifier.height(24.dp))
        Button(
            onClick = { persist(); onReady(baseUrl, language) },
            enabled = ready,
            modifier = Modifier.fillMaxWidth(),
        ) { Text("Start") }

        if (config != null && missing.isNotEmpty()) {
            Spacer(Modifier.height(8.dp))
            Text(
                "Fill in ${missing.joinToString(", ")} in the server's .env first.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        // Where each credential comes from, in the order the keys are listed above.
        Spacer(Modifier.height(24.dp))
        Text("Where to find these", style = MaterialTheme.typography.titleSmall)
        Spacer(Modifier.height(8.dp))
        GuideImage(R.drawable.api_key_guide, "Spatius App ID and API Key", DASH_URL)

        // Four steps, in the order the Agora keys are listed: pick the project under
        // Projects → take the App ID and certificate → find the agent under Agents →
        // publish it and take the pipeline id.
        Spacer(Modifier.height(10.dp))
        listOf(
            R.drawable.agora_guide_1 to "Agora Console: pick a project",
            R.drawable.agora_guide_2 to "Agora Console: App ID and certificate",
            R.drawable.agora_guide_3 to "Agora Console: find the agent",
            R.drawable.agora_guide_4 to "Agora Console: publish it and copy the id",
        ).forEach { (res, caption) ->
            GuideImage(res, caption, AGORA_URL)
            Spacer(Modifier.height(6.dp))
        }

        // The two settings that fail silently. Neither is entered anywhere on this
        // screen — the sample rate is in the server's .env and the recognition ids are
        // in its agora.py — but both have to match the console, and a mismatch reports
        // nothing at either end.
        GuideImage(R.drawable.agora_voice_guide, "The voice lives on the agent", AGORA_URL)
        Spacer(Modifier.height(6.dp))
        GuideImage(
            R.drawable.agora_guide_5,
            "Its sample rate must equal AGORA_AVATAR_SAMPLE_RATE in the server's .env — "
                + "the avatar does not resample, and a mismatch is silent.",
            AGORA_URL,
        )
        Spacer(Modifier.height(6.dp))
        GuideImage(
            R.drawable.agora_asr_guide,
            "Recognition must match the vendor, model and credential id hard-coded in "
                + "the server's agora.py.",
            AGORA_URL,
        )
    }
}

@Composable
private fun LangCard(
    title: String,
    selected: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(10.dp))
            .background(
                if (selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.10f)
                else Color.Transparent
            )
            .border(
                if (selected) 2.dp else 1.dp,
                if (selected) MaterialTheme.colorScheme.primary
                else MaterialTheme.colorScheme.outlineVariant,
                RoundedCornerShape(10.dp),
            )
            .clickable(onClick = onClick)
            .padding(12.dp),
    ) {
        Text(title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun GuideImage(resId: Int, caption: String, url: String) {
    val context = LocalContext.current
    Column {
        Image(
            painter = painterResource(resId),
            contentDescription = caption,
            contentScale = ContentScale.FillWidth,
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(10.dp))
                .clickable {
                    runCatching {
                        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                    }
                },
        )
        Text(
            caption,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
