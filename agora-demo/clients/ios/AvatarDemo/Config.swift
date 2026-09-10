import Foundation

enum Config {
    /// Agora demo server base URL. The only thing this app is configured with.
    ///
    /// Everything else — the Spatius and Agora credentials, the conversation language,
    /// the voice — lives in the server's `.env` and never reaches the device.
    ///
    /// This demo is device-only (neither the Agora SDK nor the AvatarKit build behind
    /// `AvatarKitRTC` ships a simulator slice), and a device cannot reach the dev
    /// machine's localhost — so set this to the LAN address the server prints on
    /// startup, which it also returns from `GET /health` as `lanUrl`.
    static let serverURL = "http://localhost:8790"
}
