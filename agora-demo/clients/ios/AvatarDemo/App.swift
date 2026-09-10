import SwiftUI

/// The Agora demo, on iOS.
///
/// One screen: the room. There is no configuration step — every setting this demo has
/// lives in the server's `.env`, and the server refuses to start while one is missing.
/// The server's address is the one thing this app has to know before it can ask, and it
/// is the constant in `Config.swift`.
@main
struct AvatarKitAgoraDemoApp: SwiftUI.App {
    var body: some Scene {
        WindowGroup {
            NavigationStack {
                RoomView()
            }
        }
    }
}
