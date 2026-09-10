package ai.spatius.avatarkit.directmodedemo.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * What is on screen while the server is being reached, and when it cannot be.
 *
 * There is nothing to fill in — everything lives in the server's `.env` — so all that
 * can go wrong here is not reaching it, and all this offers is the reason and a retry.
 */
@Composable
fun BootScreen(
    booting: Boolean,
    errorMsg: String,
    onRetry: () -> Unit,
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(DS.bg)
            .padding(32.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            if (booting) {
                CircularProgressIndicator(color = DS.blue)
                Text(
                    text = "Connecting to the Direct Mode server…",
                    color = DS.muted,
                    style = MaterialTheme.typography.bodyMedium,
                )
            } else {
                Text(
                    text = "Cannot start",
                    color = DS.title,
                    style = MaterialTheme.typography.headlineSmall,
                )
                Text(
                    text = errorMsg.ifBlank { "Could not reach the Direct Mode server" },
                    color = DS.muted,
                    style = MaterialTheme.typography.bodyMedium,
                    textAlign = TextAlign.Center,
                )
                Text(
                    text = "Check that the server is running, that its .env is filled in, " +
                        "and that DIRECT_MODE_URL in local.properties points at it.",
                    color = DS.muted,
                    fontSize = 11.sp,
                    textAlign = TextAlign.Center,
                )
                Button(
                    onClick = onRetry,
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(containerColor = DS.blue),
                ) {
                    Text("Retry")
                }
            }
        }
    }
}
