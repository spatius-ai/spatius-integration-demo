package ai.spatius.avatarkit.backendmodedemo.ui

import ai.spatius.avatarkit.backendmodedemo.data.defaultCharacters
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Which avatar to render, as a dialog over the playground.
 *
 * The Web client has room for a permanent list down one side; a phone does not, and
 * the avatar is what the screen is for. So this opens on demand from the header and
 * closes as soon as one is picked.
 *
 * The four are the public samples, the same set as the Web demo's characters.ts.
 * There are no portraits here — the Android demo ships no avatar artwork — so each
 * row carries an initial instead.
 */
@Composable
fun CharacterPicker(
    selectedId: String,
    loading: Boolean,
    onSelect: (id: String, name: String) -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = { if (!loading) onDismiss() },
        title = { Text("Characters", fontWeight = FontWeight.Bold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                defaultCharacters.forEach { (id, name) ->
                    val selected = id == selectedId
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(10.dp))
                            .background(
                                if (selected) DS.blue.copy(alpha = 0.10f) else Color.Transparent
                            )
                            .border(
                                width = if (selected) 2.dp else 1.dp,
                                color = if (selected) DS.blue else DS.panelBorder,
                                shape = RoundedCornerShape(10.dp),
                            )
                            // Loading one avatar while another is asked for leaves two
                            // loads racing into the same view.
                            .clickable(enabled = !loading) { onSelect(id, name) }
                            .padding(10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Box(
                            modifier = Modifier
                                .size(34.dp)
                                .clip(RoundedCornerShape(999.dp))
                                .background(DS.blue.copy(alpha = if (selected) 1f else 0.75f)),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                text = name.take(1),
                                color = Color.White,
                                fontSize = 14.sp,
                                fontWeight = FontWeight.Bold,
                            )
                        }
                        Text(name, color = DS.text, style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss, enabled = !loading) { Text("Close") }
        },
    )
}
