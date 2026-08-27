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
 * backend's address has to be told to it. The server prints its LAN address on
 * startup and returns it from `/health` as `lanUrl`.
 */
object BackendClient {

    /** What `/api/config` reports. Only what this client acts on is parsed. */
    data class ServerConfig(
        val appId: String,
        val avatarId: String,
        val region: String,
        val sampleRate: Int,
        /** Where the realtime scene's WebSocket lives. */
        val realtimeUrl: String,
        /**
         * Which credentials each scene is still waiting on, as named in the server's
         * `.env`. The sample-audio scene needs only the Spatius pair, so it can run
         * while the realtime one is still unconfigured — worth telling the user
         * rather than failing at the tap.
         */
        val missingSample: List<String>,
        val missingRealtime: List<String>,
    )

    suspend fun fetchConfig(baseUrl: String): ServerConfig = withContext(Dispatchers.IO) {
        val json = getJson("${baseUrl.trimEnd('/')}/api/config")
        val missing = json.optJSONObject("missing")
        ServerConfig(
            appId = json.optString("SPATIUS_APP_ID"),
            avatarId = json.optString("avatarId"),
            region = json.optString("region", "us-west"),
            sampleRate = json.optInt("sampleRate", 16000),
            realtimeUrl = json.optString("realtimeUrl"),
            missingSample = missing?.optJSONArray("sample").toList(),
            missingRealtime = missing?.optJSONArray("realtime").toList(),
        )
    }

    /**
     * Mint a token for this session.
     *
     * Short-lived — under an hour — so an app left open long enough has to ask again.
     * The SDK reads it at connect time, so re-minting means reconnecting.
     *
     * No API key is sent: the server uses the one in its own `.env`, which is what a
     * real deployment does. The Web demo can pass one because it has a field for it;
     * here there is deliberately no such field.
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
                // The backend answers a missing .env with a structured body naming the
                // keys. Surfacing that beats "HTTP 500", which is the first thing every
                // reader hits.
                val keys = runCatching {
                    JSONObject(body).optJSONArray("missingKeys").toList()
                }.getOrDefault(emptyList())
                error(
                    if (keys.isNotEmpty()) "Server is missing: ${keys.joinToString(", ")}"
                    else "Session token request failed (HTTP ${conn.responseCode})"
                )
            }
            JSONObject(body).getString("sessionToken")
        } finally {
            conn.disconnect()
        }
    }

    /** Reachability check for the address typed on the configuration screen. */
    suspend fun health(baseUrl: String): Boolean = withContext(Dispatchers.IO) {
        runCatching { getJson("${baseUrl.trimEnd('/')}/api/config") }.isSuccess
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

    private fun org.json.JSONArray?.toList(): List<String> {
        if (this == null) return emptyList()
        return (0 until length()).map { optString(it) }
    }
}
