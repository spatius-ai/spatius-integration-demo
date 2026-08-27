package ai.spatius.avatarkit.rtcmodedemo

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Everything the client needs to join the RTC channel, from `POST /api/session`.
 *
 * These are the Agora fields of that response. The server can also answer with a
 * LiveKit room, but never to this app — see [AgentClient.createSession].
 */
data class SessionCredentials(
    /** Used by stop to find the session again. */
    val sessionId: String,
    val appId: String,
    val channelName: String,
    val token: String,
    val uid: Int,
    /**
     * The conversational agent's uid.
     *
     * Used to tell whether it has joined the channel: ConvoAI starts the agent
     * asynchronously only after `/api/session` returns, a second or two later than this
     * client connects. Audio sent during that window is simply dropped, which presents
     * as a channel that connects but never answers.
     */
    val agentUid: Int,
    /** The avatar the server actually started; this app loads that model. */
    val avatarId: String,
    /** Spatius app id and region, needed for SDK initialization. */
    val spatiusAppId: String,
    val spatiusRegion: String,
)

/**
 * What the server has configured, from `GET /api/config`.
 *
 * Read, never written. Credentials belong in the server's `.env` — copying secrets
 * across apps on a phone is miserable, and the IME mangles them: auto-capitalization
 * and autocorrect leave damage that is invisible afterwards. One copy in `.env` covers
 * every client.
 */
data class ServerConfig(
    val avatarId: String,
    /** Which Agora settings the server still needs. This app only reads that list. */
    val missingAgora: List<String>,
)

/** Talks to the RTC Mode server. */
object AgentClient {

    private val http = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()

    private val JSON = "application/json".toMediaType()

    /**
     * What the server has configured. Called on the config screen, before anything is
     * started, so it must not create a session — this costs nothing and bills nothing.
     */
    suspend fun fetchConfig(baseUrl: String): ServerConfig = withContext(Dispatchers.IO) {
        val json = JSONObject(get(baseUrl, "/api/config"))
        val missing = json.optJSONObject("missingByTransport")?.optJSONArray("agora")
        ServerConfig(
            avatarId = json.optString("avatarId", ""),
            missingAgora = missing?.let { arr -> (0 until arr.length()).map { arr.getString(it) } }
                ?: emptyList(),
        )
    }

    /**
     * Start a session and get the credentials to join it.
     *
     * ⚠️ **Billing starts here.** [stopSession] has to be called on the way out; the
     * channel's own idle timeout is a backstop, and the minute it waits is billed.
     *
     * `transport: "agora"` is sent on every request, whatever the server's own
     * `TRANSPORT` is set to. The Android RTC SDK ships the Agora stack alone: handed
     * the LiveKit response this app would get a room URL it cannot use and fail on a
     * decode error that says nothing about the cause. The Web clients speak both and
     * leave the field out, letting the server decide.
     */
    suspend fun createSession(
        baseUrl: String,
        language: String,
        avatarId: String = "",
    ): SessionCredentials = withContext(Dispatchers.IO) {
        val body = JSONObject().apply {
            put("transport", "agora")
            put("language", language)
            if (avatarId.isNotEmpty()) put("avatarId", avatarId)
        }
        val json = JSONObject(post(baseUrl, "/api/session", body))
        SessionCredentials(
            sessionId = json.optString("sessionId", ""),
            appId = json.optString("appId", ""),
            channelName = json.optString("channelName", ""),
            token = json.optString("token", ""),
            uid = json.optInt("uid", 0),
            agentUid = json.optInt("agentUid", 0),
            avatarId = json.optString("avatarId", ""),
            spatiusAppId = json.optString("spatiusAppId", ""),
            spatiusRegion = json.optString("spatiusRegion", ""),
        )
    }

    /** End the session. Safe to call with an empty id, and safe to call twice. */
    suspend fun stopSession(baseUrl: String, sessionId: String) = withContext(Dispatchers.IO) {
        if (sessionId.isEmpty()) return@withContext
        // Failures are swallowed: this runs on the way out, where there is nothing left
        // to show an error on. The server's idle timeout is the backstop.
        runCatching { post(baseUrl, "/api/session/stop", JSONObject().put("sessionId", sessionId)) }
        Unit
    }

    // ---------------------------------------------------------------- Plumbing

    private fun normalize(baseUrl: String) = baseUrl.trim().trimEnd('/')

    private fun get(baseUrl: String, path: String): String {
        val request = Request.Builder().url(normalize(baseUrl) + path).build()
        http.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw Exception(serverMessage(body, response.code))
            return body
        }
    }

    private fun post(baseUrl: String, path: String, body: JSONObject): String {
        val request = Request.Builder()
            .url(normalize(baseUrl) + path)
            .post(body.toString().toRequestBody(JSON))
            .build()
        http.newCall(request).execute().use { response ->
            val text = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw Exception(serverMessage(text, response.code))
            return text
        }
    }

    /**
     * The server's own wording for a failure, so a missing credential names itself
     * rather than arriving as "HTTP 500".
     */
    private fun serverMessage(body: String, code: Int): String {
        val json = runCatching { JSONObject(body) }.getOrNull()
            ?: return "Server returned HTTP $code."
        json.optJSONArray("missingKeys")?.let { arr ->
            if (arr.length() > 0) {
                val keys = (0 until arr.length()).joinToString(", ") { arr.getString(it) }
                return "The server is missing: $keys"
            }
        }
        return json.optString("error").ifEmpty { "Server returned HTTP $code." }
    }
}
