import SwiftUI
import Combine
import AVFoundation
import AvatarKit

/// Shown next to the clip list so nobody reads the bundled files as the limit of
/// what Direct Mode accepts.
let audioSourceHint = """
These clips are bundled samples, not a limitation. send() takes any PCM16 audio \
at the configured sample rate — stream it live from a microphone, a TTS service, \
or your own pipeline the same way. The demo ships files so it runs without extra setup.
"""

@MainActor class AvatarViewModel: ObservableObject {
    // What the SDK reports back, one property per public callback. Every one is
    // registered whether or not this demo acts on it: which hooks exist is part of
    // what a reference client is for, and a row that only appears once it has fired
    // is a row nobody knows to expect.
    @Published var connectionState: String = "\(ConnectionState.disconnected)"
    @Published var conversationState: String = "\(ConversationState.idle)"
    /// onFirstRendering — the avatar has actually been drawn.
    @Published var rendered = false
    /// onFrameRateInfo — nil until the monitor has reported once.
    @Published var fps: Int?
    @Published var errorMessage: String?

    @Published var isSendingAudio = false
    @Published var currentlyPlayingFile: String?
    @Published var avatar: Avatar?
    @Published var toast: ToastMessage?

    // Realtime scene.
    @Published var micOn = false
    @Published var agentConnecting = false
    @Published var agentReady = false
    @Published var transcript: [(role: String, text: String)] = []

    let audioFiles: [String]
    private(set) var isConnected = false
    private var avatarController: AvatarController?
    private var sendAudioTask: Task<Void, Never>?

    private var realtime: RealtimeClient?
    private var mic: MicrophoneCapture?
    private var realtimeURL = ""
    private var language = "en"

    init() {
        var files: [String] = []
        if let path = Bundle.main.resourcePath {
            let enumerator = FileManager.default.enumerator(atPath: path)
            while let item = enumerator?.nextObject() as? String {
                if item.hasSuffix(".pcm") {
                    files.append((item as NSString).lastPathComponent)
                }
            }
        }
        audioFiles = files.sorted()
    }

    /// Told once, when the playground opens: where the agent lives and which language
    /// it should run in. Both are fixed for the session — the agent's recognition,
    /// voice and persona are all set when its session is built.
    func configureRealtime(url: String, language: String) {
        realtimeURL = url
        self.language = language
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
                // The chunk loop keeps feeding a controller that has gone, and the
                // agent would hold a model session with nowhere to send its audio.
                self.cancelSending()
                self.closeAgent()
            case .connecting:
                break
            @unknown default:
                break
            }
        }
        avatarController?.onConversationState = { [weak self] state in
            self?.conversationState = "\(state)"
        }
        avatarController?.onError = { [weak self] error in
            self?.errorMessage = error.localizedDescription
            self?.toast = ToastMessage(text: error.localizedDescription)
        }
        // Off by default and free while off, so it is switched on here to give the
        // status bar something to report.
        avatarController?.frameRateMonitorEnabled = true
        avatarController?.onFrameRateInfo = { [weak self] info in
            guard let self else { return }
            self.fps = info.fps.isFinite ? Int(info.fps.rounded()) : nil
        }
    }

    func start() { avatarController?.start() }

    /// Streams a bundled clip to the avatar.
    ///
    /// The chunking is what matters, not the file: `send` accepts any PCM16 at the
    /// configured sample rate, so a microphone or TTS stream feeds it the same way —
    /// hand it bytes as they arrive and mark the final chunk with `end: true`.
    func sendAudioFile(_ filename: String) {
        // Direct Mode has no session until start() runs, so audio sent now
        // would be dropped silently. Say so instead of leaving a dead button.
        guard isConnected else {
            toast = ToastMessage(text: "Please tap Start to connect before sending audio.", kind: .warning)
            return
        }
        guard let controller = avatarController else { return }
        cancelSending()
        controller.interrupt()

        let name = filename.replacingOccurrences(of: ".pcm", with: "")
        guard let url = Bundle.main.url(forResource: name, withExtension: "pcm"),
              let audioData = try? Data(contentsOf: url) else {
            errorMessage = "Cannot read \(filename)"
            toast = ToastMessage(text: "Cannot read \(filename)")
            return
        }

        isSendingAudio = true
        currentlyPlayingFile = filename

        let chunkSize = AvatarSDK.configuration.audioFormat.sampleRate * 2

        sendAudioTask = Task {
            var offset = 0
            while offset < audioData.count, !Task.isCancelled, self.isConnected {
                let end = min(offset + chunkSize, audioData.count)
                let isLast = end >= audioData.count
                controller.send(Data(audioData[offset..<end]), end: isLast)
                offset = end
                if !isLast {
                    try? await Task.sleep(nanoseconds: 100_000_000)
                }
            }
            if !Task.isCancelled {
                self.isSendingAudio = false
                self.currentlyPlayingFile = nil
            }
        }
    }

    func pause() { avatarController?.pause() }
    func resume() { avatarController?.resume() }

    func interrupt() {
        // Both halves: interrupt() drops what is buffered, but the chunk loop keeps
        // feeding more in and playback picks straight back up.
        cancelSending()
        avatarController?.interrupt()
        realtime?.interrupt()
    }

    func close() {
        cancelSending()
        closeAgent()
        avatarController?.close()
    }

    // MARK: - Realtime scene

    func toggleMic() async {
        guard isConnected else {
            toast = ToastMessage(text: "Tap Start to connect the avatar first.", kind: .warning)
            return
        }
        if micOn {
            mic?.stop()
            mic = nil
            micOn = false
            return
        }

        guard await requestMicPermission() else {
            toast = ToastMessage(text: "Microphone permission was denied.")
            return
        }
        // The agent is brought up on the first press rather than on entry: it costs a
        // model session, and someone who only wants the pre-recorded scene should not
        // pay for one by opening the app.
        guard await ensureAgent() else { return }

        let capture = MicrophoneCapture(sampleRate: AvatarSDK.configuration.audioFormat.sampleRate)
        do {
            try capture.start { [weak self] pcm in
                self?.realtime?.pushMicAudio(pcm)
            }
            mic = capture
            micOn = true
        } catch {
            toast = ToastMessage(text: error.localizedDescription)
        }
    }

    func say(_ text: String) async {
        let line = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !line.isEmpty else { return }
        guard isConnected else {
            toast = ToastMessage(text: "Tap Start to connect the avatar first.", kind: .warning)
            return
        }
        guard await ensureAgent() else { return }
        realtime?.say(line)
    }

    private func ensureAgent() async -> Bool {
        if realtime?.isReady == true { return true }
        guard !realtimeURL.isEmpty else { return false }

        agentConnecting = true
        defer { agentConnecting = false }

        let client = RealtimeClient(callbacks: RealtimeClient.Callbacks(
            onAudio: { [weak self] pcm in
                // Straight to the same call the pre-recorded scene ends at. `end`
                // stays false: a turn is many of these, and turn_end closes it.
                Task { @MainActor in self?.avatarController?.send(pcm, end: false) }
            },
            onTurnEnd: { [weak self] in
                // The empty final send is what tells the SDK the turn is over, so the
                // avatar returns to idle rather than holding the last mouth shape.
                Task { @MainActor in self?.avatarController?.send(Data(), end: true) }
            },
            onInterrupt: { [weak self] in
                Task { @MainActor in self?.avatarController?.interrupt() }
            },
            onTranscript: { [weak self] role, text in
                Task { @MainActor in self?.transcript.append((role: role, text: text)) }
            },
            onError: { [weak self] message in
                Task { @MainActor in self?.toast = ToastMessage(text: message) }
            },
            onClosed: { [weak self] in
                Task { @MainActor in
                    self?.agentReady = false
                    self?.micOn = false
                }
            }
        ))

        do {
            try await client.connect(url: realtimeURL, language: language)
            realtime = client
            agentReady = true
            return true
        } catch {
            toast = ToastMessage(text: error.localizedDescription)
            client.close()
            realtime = nil
            return false
        }
    }

    private func requestMicPermission() async -> Bool {
        await withCheckedContinuation { cont in
            // AVAudioApplication is iOS 17+, and this app still supports 16.
            if #available(iOS 17.0, *) {
                AVAudioApplication.requestRecordPermission { granted in
                    cont.resume(returning: granted)
                }
            } else {
                AVAudioSession.sharedInstance().requestRecordPermission { granted in
                    cont.resume(returning: granted)
                }
            }
        }
    }

    private func closeAgent() {
        mic?.stop()
        mic = nil
        micOn = false
        agentReady = false
        realtime?.close()
        realtime = nil
    }

    private func cancelSending() {
        sendAudioTask?.cancel()
        sendAudioTask = nil
        isSendingAudio = false
        currentlyPlayingFile = nil
    }
}
