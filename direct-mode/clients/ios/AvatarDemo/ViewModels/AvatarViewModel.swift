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
    /// onFirstRendering — the avatar has actually been drawn.
    @Published var rendered = false
    /// onFrameRateInfo — nil until the monitor has reported once.
    @Published var fps: Int?
    @Published var errorMessage: String?

    @Published var avatar: Avatar?
    @Published var toast: ToastMessage?

    // Conversation.
    @Published var micOn = false
    @Published var agentConnecting = false
    @Published var agentReady = false
    @Published var transcript: [(role: String, text: String)] = []

    private(set) var isConnected = false
    private var avatarController: AvatarController?

    private var realtime: RealtimeClient?
    private var mic: MicrophoneCapture?
    private var realtimeURL = ""

    /// Told once, when the playground opens: where the agent lives. The language, the
    /// models and the voice are the server's `.env` — all three are fixed when it
    /// builds the agent session, so none of them is a client setting.
    func configureRealtime(url: String) {
        realtimeURL = url
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
                // The agent would otherwise hold a model session with nowhere to
                // send its audio.
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

    func pause() { avatarController?.pause() }
    func resume() { avatarController?.resume() }

    func interrupt() {
        avatarController?.interrupt()
        realtime?.interrupt()
    }

    func close() {
        closeAgent()
        avatarController?.close()
    }

    // MARK: - Conversation

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
        // The agent is brought up on the first press rather than on entry: it costs
        // a model session, and opening the app should not start one.
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
                // Straight to controller.send(). `end`
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
            // No settings travel with it: the language, the models and the voice are
            // the server's, fixed when it builds the agent session.
            try await client.connect(url: realtimeURL)
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
}
