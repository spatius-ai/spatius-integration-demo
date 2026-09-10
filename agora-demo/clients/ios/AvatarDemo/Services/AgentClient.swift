import Foundation

/// Everything the client needs to join the Agora channel, from `POST /api/session`.
struct SessionCredentials: Decodable {
    /// Used by stop to find the session again.
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

/// Talks to the Agora demo server.
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

    /// Start a session and get the credentials to join it.
    ///
    /// The avatar id is the only thing sent: it is the character the user picked, and
    /// the only genuinely per-session thing this app knows. The credentials and the
    /// conversation language are the server's own `.env`.
    ///
    /// ⚠️ **Billing starts here.** ``stopSession(baseURL:sessionId:)`` has to be called
    /// on the way out; the channel's own idle timeout is a backstop, and the minute it
    /// waits is billed.
    static func createSession(
        baseURL: String,
        avatarId: String = ""
    ) async throws -> SessionCredentials {
        var body: [String: Any] = [:]
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

    /// One JSON POST. Both endpoints this app talks to are POSTs.
    private static func send(baseURL: String, path: String, body: [String: Any]) async throws -> Data {
        let trimmed = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let url = URL(string: trimmed + path) else {
            throw ClientError.badURL(baseURL)
        }

        var request = URLRequest(url: url)
        request.timeoutInterval = 20
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(code) else {
            throw ClientError.http(code, serverMessage(from: data))
        }
        return data
    }

    /// The server's own wording for a failure, so an upstream problem names itself
    /// rather than arriving as "HTTP 500".
    private static func serverMessage(from data: Data) -> String {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return ""
        }
        return json["error"] as? String ?? ""
    }
}
