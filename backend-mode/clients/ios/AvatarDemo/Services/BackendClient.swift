import Foundation

/// The Backend Mode server, as this client sees it.
///
/// Backend Mode means the **server** owns the Motion Server connection: it drives the
/// avatar and sends back encoded audio plus motion messages. This client never talks
/// to Spatius — it captures microphone audio and renders what arrives, so no
/// credential of any kind reaches the device.
///
/// The phone cannot reach the dev machine's localhost, so the address is fixed at
/// build time in `Config.backendModeURL` — `../../start.sh` fills in this machine's
/// LAN address.
enum BackendClient {

    /// What `/api/config` reports, and the whole of it.
    ///
    /// No credentials: the server holds them and this app has no use for one. The app
    /// id and region go to `AvatarSDK.initialize`, the avatar id is the character the
    /// playground opens with, the rate describes the PCM on the WebSocket.
    struct ServerConfig {
        let appID: String
        let avatarID: String
        let region: String
        let inputSampleRate: Int
    }

    enum BackendError: LocalizedError {
        case unreachable(String)

        var errorDescription: String? {
            switch self {
            case .unreachable(let detail):
                return "Cannot reach the Backend Mode server: \(detail)"
            }
        }
    }

    static func fetchConfig(baseURL: String) async throws -> ServerConfig {
        guard let url = URL(string: "\(trimmed(baseURL))/api/config") else {
            throw BackendError.unreachable("bad address")
        }
        let (data, response) = try await URLSession.shared.data(from: url)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw BackendError.unreachable("unexpected response")
        }
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw BackendError.unreachable("malformed response")
        }
        return ServerConfig(
            appID: json["appId"] as? String ?? "",
            avatarID: json["avatarId"] as? String ?? "",
            region: json["region"] as? String ?? "us-west",
            inputSampleRate: json["inputSampleRate"] as? Int ?? 16000
        )
    }

    /// Where the one WebSocket lives. Derived from the same address, so there is only
    /// ever one thing to type in.
    static func agentURL(baseURL: String) -> String {
        trimmed(baseURL)
            .replacingOccurrences(of: "https://", with: "wss://")
            .replacingOccurrences(of: "http://", with: "ws://")
            + "/ws/agent"
    }

    private static func trimmed(_ url: String) -> String {
        url.hasSuffix("/") ? String(url.dropLast()) : url
    }
}
