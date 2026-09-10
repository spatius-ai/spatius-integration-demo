package ai.spatius.avatarkit.backendmodedemo.ui.screens

import ai.spatius.avatarkit.backendmodedemo.BuildConfig
import ai.spatius.avatarkit.backendmodedemo.ui.DS
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

/**
 * What shows while the server's configuration is being read, and when it cannot be.
 *
 * The address is fixed at build time, so a failure here is not something the user can
 * type their way out of — the fix is in `local.properties` or in the server's `.env`,
 * and this says which.
 */
@Composable
fun BootScreen(
    error: String?,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier.fillMaxSize().background(DS.bg),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier.padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (error == null) {
                CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
                Text("Starting…", color = DS.muted, style = MaterialTheme.typography.bodyMedium)
                return@Column
            }

            Text(
                "Cannot reach the Backend Mode server",
                color = DS.title,
                style = MaterialTheme.typography.titleMedium,
                textAlign = TextAlign.Center,
            )
            Text(
                error,
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                textAlign = TextAlign.Center,
            )
            Text(
                "Trying ${BuildConfig.BACKEND_MODE_URL} — set BACKEND_MODE_URL in "
                    + "local.properties, or run ../../start.sh to fill in this "
                    + "machine's LAN address. Start the server with: cd servers/python "
                    + "&& uv run python -m app.main",
                color = DS.muted,
                style = MaterialTheme.typography.bodySmall,
                textAlign = TextAlign.Center,
            )
            Button(onClick = onRetry) { Text("Retry") }
        }
    }
}
