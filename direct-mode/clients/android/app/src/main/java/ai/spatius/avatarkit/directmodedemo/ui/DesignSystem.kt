package ai.spatius.avatarkit.directmodedemo.ui

import androidx.compose.ui.graphics.Color

/**
 * The demo's palette, shared by the configuration screen and the playground.
 *
 * Lifted out of MainActivity when the configuration screen moved to its own file —
 * the two have to agree on colours, and a second copy would drift.
 */
object DS {
    val bg = Color(0xFFF5F8FF)
    val panel = Color.White.copy(alpha = 0.88f)
    val panelBorder = Color(0x26354A8A)
    val title = Color(0xFF0B1323)
    val text = Color(0xFF27364F)
    val muted = Color(0xFF5F7598)
    val blue = Color(0xFF2563EB)
    val kicker = Color(0xFF4670C1)

    val chipOkFg = Color(0xFF14632F)
    val chipOkBg = Color(0x2923A64A)
    val chipErrFg = Color(0xFF991B1B)
    val chipErrBg = Color(0x29F04444)
    val chipIdleFg = Color(0xFF54647C)
    val chipIdleBg = Color(0x2963718C)

    /** The ring that points at whichever control is worth pressing next — the same
     *  green the Web client uses for the character list, Start and the microphone. */
    val needsPick = Color(0xFF22C55E)

    val logBorder = Color(0x2E395C92)
    val logErrBorder = Color(0x52DC2626)
    val logErrBg = Color(0xFFFDF2F2)
}
