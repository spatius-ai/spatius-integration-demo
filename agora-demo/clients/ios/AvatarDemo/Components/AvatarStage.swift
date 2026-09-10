import AvatarKit
import SwiftUI

/// The avatar rendering view.
///
/// The order is "create session → load avatar → connect RTC": both the avatar id and
/// the Spatius app id are handed down by the server along with the session, so model
/// loading has to come after the session rather than starting from something this
/// device already knows.
struct AvatarStage: View {
    @ObservedObject var session: AvatarRtcSession

    var body: some View {
        ZStack {
            if let avatar = session.avatar {
                AvatarViewRepresentable(avatar: avatar, session: session)
            }
        }
    }
}

/// Wraps the UIKit `AvatarView` for SwiftUI and joins the channel once it is ready.
///
/// The view instance is owned by ``AvatarRtcSession``: when SwiftUI rebuilds this view —
/// on rotation, for instance — the same `AvatarView` is reused, so an established RTC
/// session never loses its render target. Building a fresh one each time shows up as
/// picture and sound cutting out mid-sentence.
private struct AvatarViewRepresentable: UIViewRepresentable {
    let avatar: Avatar
    let session: AvatarRtcSession

    func makeUIView(context: Context) -> AvatarView {
        let view = session.obtainAvatarView(for: avatar)
        view.isOpaque = false
        // Connecting is idempotent (the session guards it), so a rebuild does not open
        // a second channel.
        Task { @MainActor in
            await session.connect(avatarView: view)
        }
        return view
    }

    func updateUIView(_ uiView: AvatarView, context: Context) {}

    /// On rebuild, detach the old view from its previous superview to avoid the
    /// "already has a parent view" constraint conflict.
    static func dismantleUIView(_ uiView: AvatarView, coordinator: ()) {
        uiView.removeFromSuperview()
    }
}
