import Foundation

/// The Direct Mode backend, as this client sees it.
///
/// Direct Mode clients hold no credentials: the App ID, the avatar and the region all
/// arrive from here, and the Session Token is minted server-side. That is the whole
/// reason this mode needs a backend — `SPATIUS_API_KEY` must never reach a device.
///
/// The phone cannot reach the dev machine's localhost, so unlike the Web client the
/// backend's address is a compiled-in constant — see Config.swift. The server prints
/// its LAN address on startup.
enum BackendClient {

    /// What `/api/config` reports — everything this client needs to boot.
    struct ServerConfig {
        let appID: String
        let avatarID: String
        let region: String
        let sampleRate: Int
        /// Where the agent's WebSocket lives.
        let realtimeURL: String
    }

    enum BackendError: LocalizedError {
        case unreachable(String)
        case badResponse(Int)

        var errorDescription: String? {
            switch self {
            case .unreachable(let detail):
                return "Cannot reach the Direct Mode server: \(detail)"
            case .badResponse(let code):
                return "Session token request failed (HTTP \(code))"
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
            region: json["region"] as? String ?? "auto",
            sampleRate: json["sampleRate"] as? Int ?? 16000,
            realtimeURL: json["realtimeUrl"] as? String ?? ""
        )
    }

    /// Mint a token for this session.
    ///
    /// Short-lived — under an hour — so an app left open long enough has to ask again.
    /// The SDK reads it at connect time, so re-minting means reconnecting.
    ///
    /// No API key is sent, and none is held here: the server exchanges the one in its
    /// own `.env`, which is what a real deployment does.
    static func fetchSessionToken(baseURL: String) async throws -> String {
        guard let url = URL(string: "\(trimmed(baseURL))/api/session-token") else {
            throw BackendError.unreachable("bad address")
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = "{}".data(using: .utf8)

        let (data, response) = try await URLSession.shared.data(for: request)
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]

        guard (200..<300).contains(code) else {
            throw BackendError.badResponse(code)
        }
        guard let token = json?["sessionToken"] as? String else {
            throw BackendError.badResponse(code)
        }
        return token
    }

    private static func trimmed(_ url: String) -> String {
        url.hasSuffix("/") ? String(url.dropLast()) : url
    }
}
