package ai.spatius.avatarkit.backendmodedemo.data

import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * What `/api/config` reports, and the whole of it.
 *
 * No credentials: in Backend Mode the server holds the Motion Server connection, so
 * this app never talks to Spatius and has no use for a key. The app id and region go
 * to `AvatarSDK.initialize`, the avatar id is the character the playground opens
 * with, the rate describes the PCM on the WebSocket.
 */
data class BackendConfig(
    val appId: String,
    val avatarId: String,
    val region: String,
    val inputSampleRate: Int,
)

private val httpClient = OkHttpClient.Builder()
    .connectTimeout(5, TimeUnit.SECONDS)
    .readTimeout(5, TimeUnit.SECONDS)
    .build()

/**
 * Read the server's configuration. Blocking — call it off the main thread.
 *
 * The address comes from `BuildConfig.BACKEND_MODE_URL`, which `local.properties`
 * sets: a phone cannot reach the dev machine's localhost, and this is the one thing
 * the server cannot tell the app, since it is how the app finds the server.
 */
fun fetchBackendConfig(backendUrl: String): BackendConfig {
    val httpBase = backendUrl
        .replace("ws://", "http://")
        .replace("wss://", "https://")
        .removeSuffix("/ws/agent")
        .trimEnd('/')

    val request = Request.Builder().url("$httpBase/api/config").build()
    val body = httpClient.newCall(request).execute().use { response ->
        if (!response.isSuccessful) throw Exception("HTTP ${response.code} from /api/config")
        response.body?.string() ?: throw Exception("Empty response from /api/config")
    }
    val json = JSONObject(body)
    return BackendConfig(
        appId = json.optString("appId", ""),
        avatarId = json.optString("avatarId", ""),
        region = json.optString("region", "auto"),
        inputSampleRate = json.optInt("inputSampleRate", 16000),
    )
}
