package ai.spatius.avatarkit.directmodedemo.config

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * The Direct Mode backend, as this client sees it.
 *
 * Direct Mode clients hold no credentials: the App ID, the avatar and the region all
 * arrive from here, and the Session Token is minted server-side. That is the whole
 * reason this mode needs a backend — `SPATIUS_API_KEY` must never reach a device.
 *
 * The phone cannot reach the dev machine's localhost, so unlike the Web client the
 * backend's address is a build-time constant — see `local.properties`. The server
 * prints the LAN address to use at startup.
 */
object BackendClient {

    /** What `/api/config` reports — everything this client needs to boot. */
    data class ServerConfig(
        val appId: String,
        val avatarId: String,
        val region: String,
        val sampleRate: Int,
        /** Where the agent's WebSocket lives. */
        val realtimeUrl: String,
    )

    suspend fun fetchConfig(baseUrl: String): ServerConfig = withContext(Dispatchers.IO) {
        val json = getJson("${baseUrl.trimEnd('/')}/api/config")
        ServerConfig(
            appId = json.optString("appId"),
            avatarId = json.optString("avatarId"),
            region = json.optString("region", "us-west"),
            sampleRate = json.optInt("sampleRate", 16000),
            realtimeUrl = json.optString("realtimeUrl"),
        )
    }

    /**
     * Mint a token for this session.
     *
     * Short-lived — under an hour — so an app left open long enough has to ask again.
     * The SDK reads it at connect time, so re-minting means reconnecting.
     *
     * No API key is sent, and none is held here: the server exchanges the one in
     * its own `.env`, which is what a real deployment does.
     */
    suspend fun fetchSessionToken(baseUrl: String): String = withContext(Dispatchers.IO) {
        val url = URL("${baseUrl.trimEnd('/')}/api/session-token")
        val conn = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            setRequestProperty("Content-Type", "application/json")
            doOutput = true
            connectTimeout = 10_000
            readTimeout = 15_000
        }
        try {
            conn.outputStream.use { it.write("{}".toByteArray()) }
            val body = readBody(conn)
            if (conn.responseCode !in 200..299) {
                val detail = runCatching {
                    JSONObject(body).optString("error").takeIf { it.isNotBlank() }
                }.getOrNull()
                error(
                    detail?.let { "Session token request failed: $it" }
                        ?: "Session token request failed (HTTP ${conn.responseCode})"
                )
            }
            JSONObject(body).getString("sessionToken")
        } finally {
            conn.disconnect()
        }
    }

    private fun getJson(spec: String): JSONObject {
        val conn = (URL(spec).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 10_000
            readTimeout = 15_000
        }
        try {
            val body = readBody(conn)
            if (conn.responseCode !in 200..299) {
                error("Cannot reach the Direct Mode server (HTTP ${conn.responseCode})")
            }
            return JSONObject(body)
        } finally {
            conn.disconnect()
        }
    }

    private fun readBody(conn: HttpURLConnection): String {
        val stream = if (conn.responseCode in 200..299) conn.inputStream else conn.errorStream
        return stream?.bufferedReader()?.use { it.readText() }.orEmpty()
    }
}
