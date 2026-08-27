package ai.spatius.avatarkit.rtcmodedemo

import ai.spatius.avatarkit.rtcmodedemo.ui.theme.AvatarKitRtcModeDemoTheme
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController

/**
 * RTC Mode, on Android.
 *
 * Two screens: check what the server has, then join the channel. One scene — in RTC
 * Mode the avatar joins the call itself, so there is no pre-recorded path to choose.
 */
class MainActivity : ComponentActivity() {

    private val session: AvatarRtcSession by viewModels()

    /** Settled on the config screen; the room reads them once. */
    private var baseUrl by mutableStateOf("")
    private var language by mutableStateOf(Lang.En)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            AvatarKitRtcModeDemoTheme {
                val navController = rememberNavController()
                Scaffold(modifier = Modifier.fillMaxSize()) { innerPadding ->
                    NavHost(
                        navController = navController,
                        startDestination = "config",
                        modifier = Modifier.padding(innerPadding),
                    ) {
                        composable("config") {
                            ConfigScreen(
                                onReady = { url, lang ->
                                    baseUrl = url
                                    language = lang
                                    navController.navigate("room") {
                                        popUpTo("config") { inclusive = true }
                                    }
                                },
                            )
                        }
                        composable("room") {
                            RoomScreen(
                                session = session,
                                baseUrl = baseUrl,
                                language = language,
                            )
                        }
                    }
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
