import Foundation

/// Everything the client needs to join the RTC channel, from `POST /api/session`.
///
/// The Agora demo server always answers with a channel; see
/// ``AgentClient/createSession(baseURL:language:avatarId:)`` for the one field this app
/// still sends from the days when a single server served two transports.
struct SessionCredentials: Decodable {
    /// Used by stop / interrupt / say to find the session again.
    let sessionId: String
    let appId: String
    let channelName: String
    let token: String
    let uid: UInt
    /// The conversational agent's uid.
    ///
    /// Used to tell whether it has joined the channel: ConvoAI starts the agent
    /// asynchronously only after `/api/session` returns, a second or two later than
    /// this client connects. Audio sent during that window is simply dropped, which
    /// presents as a channel that connects but never answers.
    let agentUid: UInt
    /// The avatar the server actually started; this app loads that model.
    let avatarId: String
    /// Spatius app id and region, needed for SDK initialization.
    let spatiusAppId: String
    let spatiusRegion: String
}

/// What the server has configured, from `GET /api/config`.
///
/// Read, never written. Credentials belong in the server's `.env` — copying secrets
/// across apps on a phone is miserable, and the keyboard mangles them: autocapitalization
/// and autocorrect leave damage that is invisible afterwards. One copy in `.env` covers
/// every client.
struct ServerConfig: Decodable {
    let avatarId: String
    /// Which settings the server still needs, in the order the config screen lists
    /// them.
    let missing: [String]

    /// Kept under the name the views use; every key the Agora demo server can be
    /// missing is an Agora or Spatius one.
    var missingAgora: [String] { missing }
}

/// Talks to the RTC Mode server.
enum AgentClient {

    enum ClientError: LocalizedError {
        case badURL(String)
        case http(Int, String)
        case decoding(String)

        var errorDescription: String? {
            switch self {
            case .badURL(let url):
                return "\(url) is not a valid address."
            case .http(let code, let detail):
                return detail.isEmpty ? "Server returned HTTP \(code)." : detail
            case .decoding(let what):
                return "Could not read the server's \(what) response."
            }
        }
    }

    /// What the server has configured. Called on the config screen, before anything is
    /// started, so it must not create a session — this costs nothing and bills nothing.
    static func fetchConfig(baseURL: String) async throws -> ServerConfig {
        let data = try await send(baseURL: baseURL, path: "/api/config", body: nil)
        do {
            return try JSONDecoder().decode(ServerConfig.self, from: data)
        } catch {
            throw ClientError.decoding("configuration")
        }
    }

    /// Start a session and get the credentials to join it.
    ///
    /// ⚠️ **Billing starts here.** ``stopSession(baseURL:sessionId:)`` has to be called
    /// on the way out; the channel's own idle timeout is a backstop, and the minute it
    /// waits is billed.
    ///
    /// `transport: "agora"` is still sent on every request, a leftover from when one
    /// server served both transports; the Agora demo server ignores it. Harmless, and
    /// it keeps this client working against an older combined server too.
    static func createSession(
        baseURL: String,
        language: String,
        avatarId: String = ""
    ) async throws -> SessionCredentials {
        var body: [String: Any] = ["transport": "agora", "language": language]
        if !avatarId.isEmpty { body["avatarId"] = avatarId }

        let data = try await send(baseURL: baseURL, path: "/api/session", body: body)
        do {
            return try JSONDecoder().decode(SessionCredentials.self, from: data)
        } catch {
            throw ClientError.decoding("session")
        }
    }

    /// End the session. Safe to call with an empty id, and safe to call twice.
    static func stopSession(baseURL: String, sessionId: String) async {
        guard !sessionId.isEmpty else { return }
        // Failures are swallowed: this runs on the way out, where there is nothing left
        // to show an error on. The server's idle timeout is the backstop.
        _ = try? await send(baseURL: baseURL, path: "/api/session/stop", body: ["sessionId": sessionId])
    }

    // MARK: - Plumbing

    /// One request. A nil body makes it a GET.
    private static func send(baseURL: String, path: String, body: [String: Any]?) async throws -> Data {
        let trimmed = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let url = URL(string: trimmed + path) else {
            throw ClientError.badURL(baseURL)
        }

        var request = URLRequest(url: url)
        request.timeoutInterval = 20
        if let body {
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }

        let (data, response) = try await URLSession.shared.data(for: request)
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(code) else {
            throw ClientError.http(code, serverMessage(from: data))
        }
        return data
    }

    /// The server's own wording for a failure, so a missing credential names itself
    /// rather than arriving as "HTTP 500".
    private static func serverMessage(from data: Data) -> String {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return ""
        }
        if let missing = json["missingKeys"] as? [String], !missing.isEmpty {
            return "The server is missing: \(missing.joined(separator: ", "))"
        }
        return json["error"] as? String ?? ""
    }
}
