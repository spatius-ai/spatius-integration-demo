package ai.spatius.avatarkit.directmodedemo.config

import ai.spatius.avatarkit.directmodedemo.BuildConfig
import android.content.Context

/** Which scene the playground opens in. */
enum class Scene { Sample, Realtime }

/** Which language the realtime conversation runs in. */
enum class Lang { En, Zh }

/**
 * What this client chose, as opposed to what the backend holds.
 *
 * Credentials are deliberately absent: they live in the server's `.env` and never
 * reach the device. All that is kept here is where the server is and what was picked
 * on the configuration screen.
 */
data class AppConfig(
    /** The server's LAN address, typed in once — a phone cannot reach its localhost. */
    val baseUrl: String,
    val avatarId: String,
    val scene: Scene,
    val language: Lang,
)

object ConfigStore {
    private const val PREFS = "avatarkit-direct-demo-config"
    private const val KEY_BASE_URL = "baseUrl"
    private const val KEY_AVATAR_ID = "avatarId"
    private const val KEY_SCENE = "scene"
    private const val KEY_LANGUAGE = "language"

    /** The four public sample avatars, the same set as the Web demo's characters.ts. */
    val characters = listOf(
        "41c62a7c-993c-4b6b-b6d3-549ce3c8be00" to "Kian",
        "dbb01388-7c57-47bf-ab59-c492caeb9d90" to "Julian",
        "d51ab422-3db7-47cc-afa8-7273b02bc70b" to "Clara",
        "c7069121-8245-4015-9940-82d0dc0c6bda" to "Halima",
    )

    fun load(context: Context): AppConfig {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return AppConfig(
            baseUrl = prefs.getString(KEY_BASE_URL, null) ?: BuildConfig.DIRECT_MODE_URL,
            avatarId = prefs.getString(KEY_AVATAR_ID, null).orEmpty(),
            scene = if (prefs.getString(KEY_SCENE, null) == "realtime") Scene.Realtime else Scene.Sample,
            language = if (prefs.getString(KEY_LANGUAGE, null) == "zh") Lang.Zh else Lang.En,
        )
    }

    fun save(context: Context, config: AppConfig) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_BASE_URL, config.baseUrl)
            .putString(KEY_AVATAR_ID, config.avatarId)
            .putString(KEY_SCENE, if (config.scene == Scene.Realtime) "realtime" else "sample")
            .putString(KEY_LANGUAGE, if (config.language == Lang.Zh) "zh" else "en")
            .apply()
    }
}
