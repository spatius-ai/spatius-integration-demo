import Foundation

/// The one setting this app has.
///
/// Everything else — the App ID, the API key, the avatar, the conversation language —
/// lives in the Direct Mode server's `.env`, and this app reads what it needs from
/// `GET /api/config` at launch. Credentials never reach the device.
///
/// A device cannot reach the Mac's `localhost`, so change this to the LAN address the
/// server prints at startup (`http://192.168.x.x:8090`) before running on hardware.
/// The simulator shares the Mac's network, so the default works there.
enum Config {
    static let directModeURL = "http://localhost:8090"
}
