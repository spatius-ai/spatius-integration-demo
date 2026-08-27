import Foundation

/// The Backend Mode server, as this client sees it.
///
/// Backend Mode means the **server** owns the Motion Server connection: it drives the
/// avatar and sends back encoded audio plus motion messages. This client never talks
/// to Spatius — it captures microphone audio and renders what arrives, so no
/// credential of any kind reaches the device.
///
/// The phone cannot reach the dev machine's localhost, so the server's address has to
/// be told to it. The server prints its LAN address on startup.
enum BackendClient {

    /// What `/api/config` reports. Only what this client acts on is parsed.
    struct ServerConfig {
        let appID: String
        let avatarID: String
        let region: String
        let outputSampleRate: Int
        let inputSampleRate: Int
        /// Which credentials each scene is still waiting on, as named in the server's
        /// `.env`. The sample-audio scene needs only the Spatius pair, so it can run
        /// while the realtime one is still unconfigured.
        let missingSample: [String]
        let missingRealtime: [String]
        /// The clips the pre-recorded scene can play, as listed by the server.
        let clips: [Clip]
        let clipsHint: String
    }

    struct Clip: Identifiable, Hashable {
        let name: String
        let clip: String
        var id: String { clip }
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
        let missing = json["missing"] as? [String: Any]
        let clips = (json["clips"] as? [[String: Any]] ?? []).compactMap { entry -> Clip? in
            guard let name = entry["name"] as? String,
                  let clip = entry["clip"] as? String else { return nil }
            return Clip(name: name, clip: clip)
        }
        return ServerConfig(
            appID: json["appId"] as? String ?? "",
            avatarID: json["avatarId"] as? String ?? "",
            region: json["region"] as? String ?? "us-west",
            outputSampleRate: json["outputSampleRate"] as? Int ?? 16000,
            inputSampleRate: json["inputSampleRate"] as? Int ?? 16000,
            missingSample: missing?["sample"] as? [String] ?? [],
            missingRealtime: missing?["realtime"] as? [String] ?? [],
            clips: clips,
            clipsHint: json["clipsHint"] as? String ?? ""
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
