package ai.spatius.avatarkit.rtcmodedemo

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** Everything the client needs to join the Agora channel, from `POST /api/session`. */
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

/** Talks to the Agora demo server. */
object AgentClient {

    private val http = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()

    private val JSON = "application/json".toMediaType()

    /**
     * Start a session and get the credentials to join it.
     *
     * The avatar id is the only thing sent: it is the character the user picked, and
     * the only genuinely per-session thing this app knows. The credentials and the
     * conversation language are the server's own `.env`.
     *
     * ⚠️ **Billing starts here.** [stopSession] has to be called on the way out; the
     * channel's own idle timeout is a backstop, and the minute it waits is billed.
     */
    suspend fun createSession(
        baseUrl: String,
        avatarId: String = "",
    ): SessionCredentials = withContext(Dispatchers.IO) {
        val body = JSONObject().apply {
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
     * The server's own wording for a failure, so an upstream problem names itself
     * rather than arriving as "HTTP 500".
     */
    private fun serverMessage(body: String, code: Int): String {
        val json = runCatching { JSONObject(body) }.getOrNull()
            ?: return "Server returned HTTP $code."
        return json.optString("error").ifEmpty { "Server returned HTTP $code." }
    }
}
