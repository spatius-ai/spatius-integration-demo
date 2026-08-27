package ai.spatius.avatarkit.backendmodedemo.ui.screens

import ai.spatius.avatarkit.backendmodedemo.BuildConfig
import ai.spatius.avatarkit.backendmodedemo.R
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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit

private const val DASH_URL = "https://app.spatius.ai"
private const val LIVEKIT_URL = "https://cloud.livekit.io"

/**
 * One of the server's clips: what to show, and what to ask for.
 *
 * The two differ — the name is the file without its extension — and sending the name
 * where the filename belongs gets a clip the server cannot find.
 */
data class ServerClip(val name: String, val clip: String)

/** Which scene the playground opens in. */
enum class Scene { Sample, Realtime }

/** Which language the realtime conversation runs in. */
enum class Lang { En, Zh }

/**
 * What the server reports about itself.
 *
 * `missing` is per scene rather than one list: the pre-recorded scene needs only the
 * Spatius credentials, so a server without LiveKit's is not unconfigured — it just
 * cannot run the realtime one yet.
 */
private data class ServerCheckResult(
    val reachable: Boolean,
    val missingSample: List<String>,
    val missingRealtime: List<String>,
    val appId: String,
    val avatarId: String,
    val region: String,
    /** The clips the server can play, for the pre-recorded scene. */
    val clips: List<ServerClip>,
    val error: String?,
)

/** Where the server is, and what was picked here. Credentials are never among them. */
private object ConfigStore {
    private const val PREFS = "avatarkit-backend-demo-config"
    private const val KEY_BASE_URL = "baseUrl"
    private const val KEY_SCENE = "scene"
    private const val KEY_LANGUAGE = "language"

    fun baseUrl(context: Context): String =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_BASE_URL, null)?.takeIf { it.isNotBlank() }
            ?: BuildConfig.BACKEND_MODE_URL

    fun scene(context: Context): Scene =
        if (context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(KEY_SCENE, null) == "realtime"
        ) Scene.Realtime else Scene.Sample

    fun language(context: Context): Lang =
        if (context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(KEY_LANGUAGE, null) == "zh"
        ) Lang.Zh else Lang.En

    fun save(context: Context, baseUrl: String, scene: Scene, language: Lang) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_BASE_URL, baseUrl)
            .putString(KEY_SCENE, if (scene == Scene.Realtime) "realtime" else "sample")
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
 */
@Composable
fun ConfigCheckScreen(
    onReady: (
        baseUrl: String,
        appId: String,
        avatarId: String,
        region: String,
        scene: Scene,
        language: Lang,
        clips: List<ServerClip>,
    ) -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current

    var baseUrl by remember { mutableStateOf(ConfigStore.baseUrl(context)) }
    var scene by remember { mutableStateOf(ConfigStore.scene(context)) }
    var language by remember { mutableStateOf(ConfigStore.language(context)) }

    var serverResult by remember { mutableStateOf<ServerCheckResult?>(null) }
    var checking by remember { mutableStateOf(true) }
    var checkTrigger by remember { mutableStateOf(0) }

    val isRealtime = scene == Scene.Realtime

    // Persisted as they change, not once a session succeeds: the address is what makes
    // the server reachable in the first place, so a failed Start is exactly when it
    // must not be lost — otherwise every retry begins by typing an IP address on a
    // phone keyboard again.
    fun persist() = ConfigStore.save(context, baseUrl, scene, language)

    LaunchedEffect(checkTrigger) {
        if (baseUrl.isBlank()) {
            serverResult = ServerCheckResult(
                reachable = false, missingSample = emptyList(), missingRealtime = emptyList(),
                appId = "", avatarId = "", region = "", clips = emptyList(),
                error = "No server address",
            )
            checking = false
            return@LaunchedEffect
        }
        checking = true
        serverResult = null
        serverResult = try {
            withContext(Dispatchers.IO) { checkServer(baseUrl) }
        } catch (e: Exception) {
            ServerCheckResult(
                reachable = false, missingSample = emptyList(), missingRealtime = emptyList(),
                appId = "", avatarId = "", region = "", clips = emptyList(), error = e.message,
            )
        }
        checking = false
    }

    val missing = serverResult?.let { if (isRealtime) it.missingRealtime else it.missingSample }
        ?: emptyList()
    val allReady = serverResult?.reachable == true && missing.isEmpty() && !checking

    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(24.dp)
            .verticalScroll(rememberScrollState()),
    ) {
        Text("AvatarKit Backend Mode Demo", style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(4.dp))
        Text(
            "The server drives the avatar and streams it back. Pick where its audio comes from.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        // The scene goes first: it decides which credentials are required below.
        Spacer(Modifier.height(20.dp))
        Text("Scene", style = MaterialTheme.typography.titleSmall)
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SceneCard(
                title = "Pre-recorded audio",
                subtitle = "Play a server clip",
                selected = !isRealtime,
                modifier = Modifier.weight(1f),
            ) { scene = Scene.Sample; persist() }
            SceneCard(
                title = "Realtime audio",
                subtitle = "Talk to the avatar",
                selected = isRealtime,
                modifier = Modifier.weight(1f),
            ) { scene = Scene.Realtime; persist() }
        }

        // The server's address. The one thing that cannot come from the server itself,
        // since this is how the phone finds it.
        Spacer(Modifier.height(20.dp))
        Text("Server address", style = MaterialTheme.typography.titleSmall)
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = baseUrl,
            onValueChange = { baseUrl = it; persist() },
            singleLine = true,
            placeholder = { Text("http://192.168.x.x:8765") },
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

        // Only the realtime scene reaches an agent, so this appears with it.
        //
        // Chosen here rather than inside the scene: recognition, synthesis and the
        // persona are all fixed when the agent session is built, so it cannot be
        // switched on a running conversation.
        if (isRealtime) {
            Spacer(Modifier.height(20.dp))
            Text("Conversation language", style = MaterialTheme.typography.titleSmall)
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SceneCard(
                    title = "English",
                    subtitle = "",
                    selected = language == Lang.En,
                    modifier = Modifier.weight(1f),
                ) { language = Lang.En; persist() }
                SceneCard(
                    title = "中文",
                    subtitle = "",
                    selected = language == Lang.Zh,
                    modifier = Modifier.weight(1f),
                ) { language = Lang.Zh; persist() }
            }
            Spacer(Modifier.height(4.dp))
            Text(
                "Sets speech recognition, the voice, and the assistant's persona.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

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
        } else {
            val result = serverResult
            if (result == null || !result.reachable) {
                Text(
                    "Cannot reach the server",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
                result?.error?.let {
                    Text(
                        it,
                        style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Spacer(Modifier.height(4.dp))
                Text(
                    "Start it with: cd servers/python && uv run uvicorn app.main:app --host 0.0.0.0",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                // Which keys this scene needs, named as they appear in the server's .env.
                val keys = if (isRealtime) {
                    listOf(
                        "SPATIUS_API_KEY", "SPATIUS_APP_ID",
                        "LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET",
                    )
                } else {
                    listOf("SPATIUS_API_KEY", "SPATIUS_APP_ID")
                }
                keys.forEach { key ->
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
                    "Set these in the server's .env — they never reach this device. In "
                        + "Backend Mode the server holds the Motion Server connection, so this "
                        + "app never talks to Spatius at all.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        Spacer(Modifier.height(24.dp))

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            OutlinedButton(
                onClick = { checkTrigger++ },
                enabled = !checking,
                modifier = Modifier.weight(1f),
            ) { Text("Recheck") }
            Button(
                onClick = {
                    serverResult?.let {
                        persist()
                        onReady(baseUrl, it.appId, it.avatarId, it.region, scene, language, it.clips)
                    }
                },
                enabled = allReady,
                modifier = Modifier.weight(1f),
            ) { Text("Start") }
        }

        if (serverResult?.reachable == true && missing.isNotEmpty()) {
            Spacer(Modifier.height(8.dp))
            Text(
                "Fill in ${missing.joinToString(", ")} in the server's .env first.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        // One guide per credential set, in the order the keys are listed above. The
        // Spatius one is always there; LiveKit's is added by the realtime scene rather
        // than replacing it, since that scene needs both.
        Spacer(Modifier.height(24.dp))
        Text("Where to find these", style = MaterialTheme.typography.titleSmall)
        Spacer(Modifier.height(8.dp))
        GuideImage(R.drawable.api_key_guide, "App ID and API Key", DASH_URL)
        if (isRealtime) {
            Spacer(Modifier.height(8.dp))
            GuideImage(R.drawable.livekit_guide_1, "LiveKit: open project settings", LIVEKIT_URL)
            Spacer(Modifier.height(6.dp))
            GuideImage(R.drawable.livekit_guide_2, "LiveKit: API keys", LIVEKIT_URL)
        }
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
            .background(
                if (selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.10f) else Color.Transparent
            )
            .border(
                if (selected) 2.dp else 1.dp,
                if (selected) MaterialTheme.colorScheme.primary
                else MaterialTheme.colorScheme.outlineVariant,
                RoundedCornerShape(10.dp),
            )
            .clickable(onClick = onClick)
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
        if (subtitle.isNotEmpty()) {
            Text(
                subtitle,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
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

private val httpClient = OkHttpClient.Builder()
    .connectTimeout(5, TimeUnit.SECONDS)
    .readTimeout(5, TimeUnit.SECONDS)
    .build()

private fun checkServer(backendUrl: String): ServerCheckResult {
    val httpBase = backendUrl
        .replace("ws://", "http://")
        .replace("wss://", "https://")
        .removeSuffix("/ws/agent")
        .trimEnd('/')

    val request = Request.Builder().url("$httpBase/api/config").build()
    val body = httpClient.newCall(request).execute().body?.string()
        ?: throw Exception("Empty response from /api/config")
    val json = JSONObject(body)

    // `missing` is an object keyed by scene, not a flat list.
    val missingObj = json.optJSONObject("missing")
    fun listFor(key: String): List<String> {
        val arr = missingObj?.optJSONArray(key) ?: return emptyList()
        return (0 until arr.length()).map { arr.getString(it) }
    }

    return ServerCheckResult(
        reachable = true,
        missingSample = listFor("sample"),
        missingRealtime = listFor("realtime"),
        appId = json.optString("appId", ""),
        avatarId = json.optString("avatarId", ""),
        region = json.optString("region", "us-west"),
        clips = json.optJSONArray("clips")?.let { arr ->
            (0 until arr.length()).mapNotNull { i ->
                arr.optJSONObject(i)?.let {
                    ServerClip(it.optString("name", ""), it.optString("clip", ""))
                }
            }
        } ?: emptyList(),
        error = null,
    )
}
