import SwiftUI
import Combine
import AVFoundation
import AvatarKit

@MainActor class AvatarViewModel: ObservableObject {
    // What the SDK reports back, one property per public callback. Every one is
    // registered whether or not this demo acts on it: which hooks exist is part of
    // what a reference client is for, and a row that only appears once it has fired
    // is a row nobody knows to expect.
    @Published var connectionState: String = "\(ConnectionState.disconnected)"
    @Published var conversationState: String = "\(ConversationState.idle)"
    /// onFrameRateInfo — nil until the monitor has reported once.
    @Published var fps: Int?
    @Published var errorMessage: String?
    @Published var avatar: Avatar?

    // Backend Mode published state
    @Published var backendConnected = false
    @Published var backendConnecting = false
    @Published var backendMicActive = false
    /// Which clip is streaming, so only its own row says so.
    @Published var playingClip: String?

    private var isConnected = false
    private var avatarController: AvatarController?

    /// Where the server is. Told once by the view, since the address is typed on the
    /// configuration screen rather than compiled in — a phone cannot reach the dev
    /// machine's localhost.
    var backendBaseURL = Config.backendModeURL

    /// Which language the agent should listen and reply in, chosen on the
    /// configuration screen. Fixed for the session: recognition, the voice and the
    /// persona are all set when the agent session is built.
    var language = "en"

    /// Whether `start_agent` has been sent on this connection.
    private var agentStarted = false

    /// Ask the server to bring the agent up, once per connection.
    ///
    /// The pre-recorded scene never calls this — it costs a model session, and a clip
    /// needs no agent at all.
    private func ensureAgent() {
        guard !agentStarted, let ws = hostWsTask, ws.state == .running else { return }
        agentStarted = true
        ws.send(.string(jsonString(["type": "start_agent", "language": language]))) { _ in }
    }

    func setAvatarController(_ controller: AvatarController) {
        avatarController = controller
        avatarController?.onConnectionState = { [weak self] state in
            guard let self else { return }
            self.connectionState = "\(state)"
            switch state {
            case .connected:
                self.isConnected = true
            case .disconnected, .failed:
                self.isConnected = false
            case .connecting:
                break
            @unknown default:
                break
            }
        }
        avatarController?.onConversationState = { [weak self] state in
            guard let self else { return }
            self.conversationState = "\(state)"
            // The server streams a clip and reports nothing when it finishes, so the
            // avatar going back to idle is what says playback is over.
            if "\(state)" == "\(ConversationState.idle)" {
                self.playingClip = nil
            }
        }
        avatarController?.onError = { [weak self] error in
            self?.errorMessage = error.localizedDescription
        }
        // Off by default and free while off, so it is switched on here to give the
        // status bar something to report.
        avatarController?.frameRateMonitorEnabled = true
        avatarController?.onFrameRateInfo = { [weak self] info in
            self?.fps = info.fps.isFinite ? Int(info.fps.rounded()) : nil
        }
    }

    /// Tell the server which avatar it is driving.
    ///
    /// Sent on connect and again on every character change: the WebSocket outlives the
    /// avatar, so without this the server keeps driving the one it was first told
    /// about and the motion no longer matches what is on screen.
    func setAvatar(_ avatarId: String) {
        guard !avatarId.isEmpty, let ws = hostWsTask, ws.state == .running else { return }
        ws.send(.string(jsonString(["type": "set_avatar", "avatarId": avatarId]))) { _ in }
    }

    /// Ask the server to stream one of its clips into the avatar.
    ///
    /// The clips live on the server and never pass through this app: what arrives
    /// here is the encoded audio and motion to render, exactly as in the realtime
    /// scene. Only where the audio came from differs.
    func playSample(_ clip: String) {
        guard let ws = hostWsTask, ws.state == .running else { return }
        playingClip = clip
        ws.send(.string(jsonString(["type": "play_sample", "clip": clip]))) { _ in }
    }

    func start() { avatarController?.start() }
    func pause() { avatarController?.pause() }
    func resume() { avatarController?.resume() }

    /// Cut off what the avatar is saying.
    ///
    /// The microphone stays open: interrupting means "stop talking", not "I am done
    /// talking" — closing it here made every interruption end the turn as well.
    func interrupt() {
        avatarController?.interrupt()
    }

    // MARK: - JSON Helper

    private func jsonString(_ dict: [String: Any]) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: dict),
              let str = String(data: data, encoding: .utf8) else { return "{}" }
        return str
    }

    // MARK: - Backend Mode

    /// Derived from the address typed on the configuration screen, so there is only
    /// ever one thing to enter.
    private var backendModeURL: URL {
        URL(string: BackendClient.agentURL(baseURL: backendBaseURL))!
    }
    private var hostWsTask: URLSessionWebSocketTask?
    private var hostSession: URLSession?
    private var hostReceiveTask: Task<Void, Never>?
    /// The id `yieldAudioData` handed back, which frames for the same reply need.
    private var conversationId: String?

    // Microphone
    private var audioEngine: AVAudioEngine?

    func backendConnect() {
        guard hostWsTask == nil, !backendConnecting else { return }
        backendConnecting = true
        errorMessage = nil

        let session = URLSession(configuration: .default)
        hostSession = session
        let wsTask = session.webSocketTask(with: backendModeURL)
        hostWsTask = wsTask
        wsTask.resume()

        // Start persistent receive loop
        hostReceiveTask = Task { [weak self] in
            await self?.hostReceiveLoop(wsTask)
        }
    }

    func backendDisconnect() {
        agentStarted = false
        backendStopMic()
        hostReceiveTask?.cancel()
        hostReceiveTask = nil
        hostWsTask?.cancel(with: .goingAway, reason: nil)
        hostWsTask = nil
        hostSession = nil
        backendConnected = false
        backendConnecting = false
        conversationId = nil
    }

    func backendStartMic() {
        guard backendConnected, !backendMicActive else { return }

        // Brought up on the first press rather than on connect: the agent costs a
        // model session, and someone who only wants the pre-recorded scene should not
        // pay for one by opening the app.
        ensureAgent()

        // .voiceChat asks for the echo-cancelling route, which keeps the avatar's own
        // voice out of the microphone — without it the agent transcribes its own reply
        // back to itself.
        let audioSession = AVAudioSession.sharedInstance()
        do {
            try audioSession.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetooth])
            try audioSession.setActive(true)
        } catch {
            errorMessage = "Audio session error: \(error.localizedDescription)"
            return
        }

        let engine = AVAudioEngine()
        audioEngine = engine
        let inputNode = engine.inputNode

        // The session mode alone does not switch cancellation on: the AEC lives in the
        // input's IO unit and starts disabled. Browsers do this for you —
        // getUserMedia's echoCancellation is on by default — which is why the Web
        // client needs no equivalent.
        //
        // Set before the tap is installed: toggling it reconfigures the node, and the
        // format read below has to be the one that ends up in effect.
        if #available(iOS 13.0, *) {
            try? inputNode.setVoiceProcessingEnabled(true)
        }

        let inputFormat = inputNode.outputFormat(forBus: 0)

        // Target format: 16kHz mono Int16
        guard let targetFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true) else {
            errorMessage = "Cannot create target audio format"
            return
        }

        guard let converter = AVAudioConverter(from: inputFormat, to: targetFormat) else {
            errorMessage = "Cannot create audio converter"
            return
        }

        let bufferSize: AVAudioFrameCount = 4096
        inputNode.installTap(onBus: 0, bufferSize: bufferSize, format: inputFormat) { [weak self] buffer, _ in
            guard let self, let ws = self.hostWsTask, ws.state == .running else { return }

            let frameCount = AVAudioFrameCount(Double(buffer.frameLength) * 16000.0 / inputFormat.sampleRate)
            guard let outputBuffer = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: frameCount) else { return }

            var conversionError: NSError?
            converter.convert(to: outputBuffer, error: &conversionError) { _, outStatus in
                outStatus.pointee = .haveData
                return buffer
            }

            if conversionError != nil { return }

            guard let int16Data = outputBuffer.int16ChannelData else { return }
            let byteCount = Int(outputBuffer.frameLength) * 2
            let data = Data(bytes: int16Data[0], count: byteCount)
            let b64 = data.base64EncodedString()
            let msg = self.jsonString(["type": "mic_audio", "audio": b64])
            ws.send(.string(msg)) { _ in }
        }

        do {
            try engine.start()
            backendMicActive = true
        } catch {
            errorMessage = "Audio engine start error: \(error.localizedDescription)"
            inputNode.removeTap(onBus: 0)
            audioEngine = nil
        }
    }

    func backendStopMic() {
        guard backendMicActive else { return }
        audioEngine?.inputNode.removeTap(onBus: 0)
        audioEngine?.stop()
        // Turned back off with the tap: voice processing stays on the node otherwise,
        // and it keeps the session in its duplex route — which thins out the avatar's
        // voice on the next clip even though nothing is recording.
        if #available(iOS 13.0, *) {
            try? audioEngine?.inputNode.setVoiceProcessingEnabled(false)
        }
        audioEngine = nil
        backendMicActive = false

        if let ws = hostWsTask, ws.state == .running {
            ws.send(.string(jsonString(["type": "mic_end"]))) { _ in }
        }
    }

    func backendSendText(_ text: String) {
        // Same as the microphone: the agent is what turns a line into speech.
        ensureAgent()
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        // Auto-connect if needed
        if !backendConnected && !backendConnecting {
            backendConnect()
        }

        let payload = jsonString(["type": "text_query", "text": trimmed])

        guard let ws = hostWsTask, ws.state == .running else {
            // Queue send after connection
            Task {
                // Wait for connection (up to 3s)
                for _ in 0..<30 {
                    if backendConnected { break }
                    try? await Task.sleep(nanoseconds: 100_000_000)
                }
                guard backendConnected, let ws = self.hostWsTask, ws.state == .running else { return }
                ws.send(.string(payload)) { _ in }
            }
            return
        }

        ws.send(.string(payload)) { _ in }
    }

    private func hostReceiveLoop(_ wsTask: URLSessionWebSocketTask) async {
        while !Task.isCancelled {
            guard let message = try? await wsTask.receive() else {
                // Connection lost
                await MainActor.run {
                    self.backendConnected = false
                    self.backendConnecting = false
                    self.backendMicActive = false
                    self.hostWsTask = nil
                    self.conversationId = nil
                }
                break
            }

            switch message {
            case .string(let text):
                guard let data = text.data(using: .utf8),
                      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let type = json["type"] as? String else { continue }

                await handleHostMessage(type: type, json: json)

            case .data:
                break
            @unknown default:
                break
            }
        }
    }

    private func handleHostMessage(type: String, json: [String: Any]) {
        // No blanket guard on the controller: `ready` arrives while the AvatarView is
        // still being made, and dropping it there left `backendConnected` false for
        // the rest of the session — every control stayed disabled and the server was
        // never told which avatar to drive. Only the frames actually need one.
        switch type {
        case "ready":
            backendConnected = true
            backendConnecting = false
            let avatarId = avatar?.id ?? ""
            hostWsTask?.send(.string(jsonString(["type": "set_avatar", "avatarId": avatarId]))) { _ in }
            return

        default:
            break
        }

        guard let controller = avatarController else { return }

        switch type {
        case "avatar_audio":
            let audioB64 = json["audio"] as? String ?? ""
            let audioData = audioB64.isEmpty ? Data() : (Data(base64Encoded: audioB64) ?? Data())
            let isLast = json["isLast"] as? Bool ?? false
            // Kept from every call, not just the first: the id identifies the round
            // the frames below belong to, and holding the one handed back at the
            // start of a reply sends later frames to a round that has already ended.
            // A nil return means "no change", so the last known id stands.
            conversationId = controller.yieldAudioData(audioData, end: isLast) ?? conversationId

        case "avatar_frames":
            guard let framesArr = json["frames"] as? [String],
                  let cid = conversationId else { return }
            let frames = framesArr.compactMap { Data(base64Encoded: $0) }
            if !frames.isEmpty {
                controller.yieldFramesData(frames, conversationID: cid)
            }

        case "interrupt":
            conversationId = nil
            controller.interrupt()

        case "error":
            let errMsg = json["message"] as? String ?? "Unknown error"
            errorMessage = errMsg
            // A clip that never starts leaves its button on "..." forever: the
            // release comes from the avatar returning to idle, and a turn that was
            // rejected never enters playing in the first place.
            playingClip = nil

        default:
            break
        }
    }

    func close() {
        backendDisconnect()
        avatarController?.close()
    }
}
