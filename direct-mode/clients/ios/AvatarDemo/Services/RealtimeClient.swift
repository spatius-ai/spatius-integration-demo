import Foundation

/// The realtime scene's link to the backend agent.
///
/// Direct Mode either way: the client owns the Motion Server connection and drives the
/// avatar itself. The scenes differ only in where the audio comes from —
///
///   pre-recorded  a bundled .pcm file  ──────────────────►  controller.send()
///   realtime      mic ──ws──► agent (ASR/LLM/TTS) ──ws──►  controller.send()
///
/// — so both end at the same call and the rendering side is untouched.
///
/// There is no LiveKit SDK here on purpose. The agent runs server-side without a room:
/// `AgentSession` only builds a RoomIO when its audio input and output are unset, and
/// the backend sets both (see servers/python/realtime.py), so its speech comes back
/// over this plain WebSocket as PCM16.
final class RealtimeClient: NSObject {

    struct Callbacks {
        /// A reply started arriving; the bytes are PCM16 for `controller.send`.
        var onAudio: (Data) -> Void = { _ in }
        /// The agent finished a reply — the empty final send closes the turn.
        var onTurnEnd: () -> Void = {}
        /// The user talked over the reply; drop what has not played yet.
        var onInterrupt: () -> Void = {}
        var onTranscript: (String, String) -> Void = { _, _ in }
        var onError: (String) -> Void = { _ in }
        var onClosed: () -> Void = {}
    }

    private var task: URLSessionWebSocketTask?
    private let callbacks: Callbacks
    private var readyContinuation: CheckedContinuation<Void, Error>?

    private(set) var isReady = false

    init(callbacks: Callbacks) {
        self.callbacks = callbacks
        super.init()
    }

    /// Connect, and resolve once the agent is up and listening.
    func connect(url: String, language: String) async throws {
        guard let endpoint = URL(string: url) else {
            throw NSError(domain: "RealtimeClient", code: 0, userInfo: [
                NSLocalizedDescriptionKey: "Cannot reach the agent at \(url)",
            ])
        }
        let session = URLSession(configuration: .default)
        let socket = session.webSocketTask(with: endpoint)
        task = socket
        socket.resume()
        receive()

        let start = try JSONSerialization.data(
            withJSONObject: ["type": "start", "language": language]
        )
        try await socket.send(.string(String(decoding: start, as: UTF8.self)))

        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            readyContinuation = cont
        }
    }

    private func receive() {
        task?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .failure(let error):
                self.isReady = false
                if let cont = self.readyContinuation {
                    self.readyContinuation = nil
                    cont.resume(throwing: error)
                } else {
                    self.callbacks.onError(error.localizedDescription)
                }
                self.callbacks.onClosed()
            case .success(let message):
                if case .string(let text) = message {
                    self.handle(text)
                }
                // One receive only ever yields one message, so the next has to be
                // asked for or the socket goes quiet after the first.
                self.receive()
            }
        }
    }

    private func handle(_ text: String) {
        guard let data = text.data(using: .utf8),
              let msg = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = msg["type"] as? String else { return }

        switch type {
        case "ready":
            isReady = true
            if let cont = readyContinuation {
                readyContinuation = nil
                cont.resume()
            }
        case "audio":
            if let encoded = msg["audio"] as? String,
               let pcm = Data(base64Encoded: encoded), !pcm.isEmpty {
                callbacks.onAudio(pcm)
            }
        case "turn_end":
            callbacks.onTurnEnd()
        case "interrupt":
            callbacks.onInterrupt()
        case "transcript":
            callbacks.onTranscript(
                msg["role"] as? String ?? "",
                msg["text"] as? String ?? ""
            )
        case "error":
            let message = msg["message"] as? String ?? "Agent error"
            callbacks.onError(message)
            if let cont = readyContinuation {
                readyContinuation = nil
                cont.resume(throwing: NSError(domain: "RealtimeClient", code: 1, userInfo: [
                    NSLocalizedDescriptionKey: message,
                ]))
            }
        default:
            break
        }
    }

    /// Microphone audio, as PCM16 at the rate the SDK was initialized with.
    func pushMicAudio(_ pcm: Data) {
        guard isReady, let task else { return }
        let payload: [String: Any] = [
            "type": "mic_audio",
            "audio": pcm.base64EncodedString(),
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: payload) else { return }
        task.send(.string(String(decoding: data, as: UTF8.self))) { _ in }
    }

    /// Speak a fixed line, for trying the scene without a microphone.
    func say(_ text: String) {
        send(["type": "text", "text": text])
    }

    func interrupt() {
        send(["type": "interrupt"])
    }

    func close() {
        isReady = false
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
    }

    private func send(_ payload: [String: Any]) {
        guard let task, let data = try? JSONSerialization.data(withJSONObject: payload) else { return }
        task.send(.string(String(decoding: data, as: UTF8.self))) { _ in }
    }
}
