package ai.spatius.avatarkit.directmodedemo.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

enum class ToastKind { Error, Warning }

data class ToastMessage(
    val text: String,
    val kind: ToastKind = ToastKind.Error,
    // Repeated identical failures must still re-trigger the animation, so the
    // message carries a serial rather than relying on text equality.
    val serial: Long = 0L,
)

/**
 * Mirrors the web demos' Toast: SDK errors and blocked actions surface here
 * instead of only reaching the log panel.
 */
@Composable
fun ToastHost(
    message: ToastMessage?,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var visible by remember { mutableStateOf(false) }

    LaunchedEffect(message?.serial) {
        if (message == null) {
            visible = false
            return@LaunchedEffect
        }
        visible = true
        delay(4_000)
        visible = false
        // Let the exit animation finish before clearing the slot.
        delay(200)
        onDismiss()
    }

    Box(modifier = modifier.fillMaxWidth(), contentAlignment = Alignment.TopCenter) {
        AnimatedVisibility(
            visible = visible && message != null,
            enter = fadeIn() + slideInVertically { -it },
            exit = fadeOut() + slideOutVertically { -it },
        ) {
            val kind = message?.kind ?: ToastKind.Error
            val bg = when (kind) {
                ToastKind.Error -> Color(0xFFB3261E)
                ToastKind.Warning -> Color(0xFF8A5A00)
            }
            Text(
                text = message?.text.orEmpty(),
                color = Color.White,
                textAlign = TextAlign.Center,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier
                    .padding(horizontal = 16.dp, vertical = 12.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(bg)
                    .padding(horizontal = 16.dp, vertical = 10.dp),
            )
        }
    }
}
