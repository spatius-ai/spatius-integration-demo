package ai.spatius.avatarkit.rtcmodedemo

import ai.spatius.avatarkit.rtcmodedemo.ui.theme.AvatarKitAgoraDemoTheme
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.ui.Modifier

/**
 * The Agora demo, on Android.
 *
 * One screen: the room. There is no configuration step — every setting this demo has
 * lives in the server's `.env`, and the server refuses to start while one is missing.
 * The server's address is the one thing this app has to know before it can ask, and it
 * comes from `RTC_MODE_URL` in `local.properties` at build time.
 *
 * One scene, too: the avatar joins the call itself, so there is no pre-recorded path
 * to choose.
 */
class MainActivity : ComponentActivity() {

    private val session: AvatarRtcSession by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            AvatarKitAgoraDemoTheme {
                Scaffold(modifier = Modifier.fillMaxSize()) { innerPadding ->
                    RoomScreen(
                        session = session,
                        modifier = Modifier.padding(innerPadding),
                    )
                }
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        // A session bills continuously from creation, so leaving has to stop it rather
        // than leaving it to the channel's idle timeout.
        session.stop()
    }
}
