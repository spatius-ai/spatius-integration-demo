import AgoraRtcKit
import AvatarKit
import AvatarKitRTC
import Foundation

/// The avatar's RTC session: ask the server for a channel, initialize the SDK, load the
/// avatar, connect, publish the microphone.
///
/// RTC Mode is the one path where the avatar joins the call itself. This client feeds it
/// no driving data at all: the agent encodes the animation into the video stream's SEI,
/// the SDK parses it out to drive rendering, and audio travels on an RTC audio track.
///
///     Direct    client ──audio──►  Motion Server           (client drives)
///     Backend   client ──mic───►  server ──► Motion Server (server drives)
///     RTC       client ◄────  RTC channel  ────► agent     (neither — it is in the call)
///
/// So there is no `send()` and no `yieldAudioData()` here. Once connected, everything
/// arrives as a stream.
@MainActor
final class AvatarRtcSession: ObservableObject {

    /// Stage text for the waiting overlay.
    @Published private(set) var status = "Preparing…"
    /// Model download progress, 0-100. Only moves on a cache miss.
    @Published private(set) var downloadPercent: Int?
    /// Whether the avatar's first frame has rendered — what dismisses the overlay.
    @Published private(set) var isReady = false
    /// Whether the agent has joined and can be spoken to. The microphone stays disabled
    /// until this flips: audio sent earlier is dropped without an error anywhere.
    @Published private(set) var agentReady = false
    /// Whether the microphone is currently published.
    @Published private(set) var micActive = false
    /// The last failure, shown in the room rather than replacing it.
    @Published var errorMessage: String?

    /// The avatar handed down by the server. The stage only builds its view once this
    /// has loaded.
    @Published private(set) var avatar: Avatar?

    private var provider: AgoraProvider?
    private var player: AvatarPlayer?
    private var baseURL = ""
    /// The session id issued by the server, used on the way out to stop billing.
    private(set) var sessionId = ""
    /// The conversational agent's uid, used to tell whether it has joined the channel.
    private var agentUid: UInt = 0
    /// A session bills from the moment it is created, and SwiftUI may fire the task that
    /// starts one more than once.
    private var hasStarted = false

    /// The render view is owned and reused by the session.
    ///
    /// Rotation makes SwiftUI rebuild the stage, and creating a fresh AvatarView each
    /// time would leave the established RTC session without a render target — it shows
    /// up as picture and sound cutting out mid-sentence. The session outlives the view,
    /// so keeping the view here is what makes it stable.
    private(set) var avatarView: AvatarView?

    private static var sdkInitialized = false

    /// Global SDK initialization; idempotent.
    ///
    /// `.rtc` has to be declared: AvatarPlayer validates it during init, and getting it
    /// wrong files this path's telemetry under the wrong mode.
    ///
    /// The app id comes from the server rather than from this device: it has to match
    /// the one the server used to start the avatar, and a mismatch connects fine but
    /// shows nothing. The SDK reads it once at initialize and it cannot be changed
    /// afterwards without relaunching.
    private static func initializeSDK(appId: String, region: String) {
        guard !sdkInitialized else { return }
        sdkInitialized = true
        AvatarSDK.initialize(
            appID: appId,
            configuration: Configuration(
                region: region.isEmpty ? "cn-beijing" : region,
                drivingServiceMode: .rtc,
                logLevel: .warning
            )
        )
    }

    /// Get the render view; the first call creates it for the given avatar, and every
    /// call after that reuses it.
    func obtainAvatarView(for avatar: Avatar) -> AvatarView {
        if let existing = avatarView { return existing }
        let view = AvatarView(avatar: avatar)
        view.onFirstRendering = { [weak self] in
            Task { @MainActor in self?.isReady = true }
        }
        avatarView = view
        return view
    }

    /// Create the session and load the avatar, up to the point where a view can be built.
    ///
    /// Idempotent: a session bills from creation, and SwiftUI may fire this more than
    /// once. On failure the session is stopped and the guard released, so the caller can
    /// retry.
    func prepare(baseURL: String, language: String, avatarId: String = "") async {
        guard !hasStarted else { return }
        hasStarted = true
        self.baseURL = baseURL
        errorMessage = nil

        do {
            status = "Creating a session…"
            let credentials = try await AgentClient.createSession(
                baseURL: baseURL, language: language, avatarId: avatarId
            )
            sessionId = credentials.sessionId
            agentUid = credentials.agentUid
            self.credentials = credentials

            Self.initializeSDK(appId: credentials.spatiusAppId, region: credentials.spatiusRegion)

            // From here on the session is billing, so any later failure has to stop it.
            status = "Loading avatar…"
            avatar = try await AvatarManager.shared.load(id: credentials.avatarId) { progress in
                Task { @MainActor in
                    self.downloadPercent = Int(progress.fractionCompleted * 100)
                }
            }
            downloadPercent = nil
        } catch {
            await AgentClient.stopSession(baseURL: baseURL, sessionId: sessionId)
            sessionId = ""
            // Released so a retry is possible; otherwise the guard blocks every
            // subsequent attempt too.
            hasStarted = false
            status = "Could not start"
            errorMessage = error.localizedDescription
        }
    }

    /// The credentials from ``prepare``, used by ``connect(avatarView:)``.
    private var credentials: SessionCredentials?
    private var hasConnected = false

    /// Join the channel.
    ///
    /// Idempotent for the same reason as prepare: the view that calls this may be built
    /// more than once, and the guard has to live on the session rather than on the view.
    func connect(avatarView: AvatarView) async {
        guard !hasConnected, let credentials else { return }
        hasConnected = true

        do {
            status = "Joining the channel…"
            let provider = AgoraProvider()
            let player = AvatarPlayer(
                provider: provider,
                avatarView: avatarView,
                options: AvatarPlayerOptions(logLevel: .warning)
            )
            self.provider = provider
            self.player = player

            // Subscribed before connecting, or the events fired at the moment of
            // connection are missed.
            player.subscribe { [weak self] event in
                Task { @MainActor in self?.handle(event: event) }
            }

            try await player.connect(AgoraConnectionConfig(
                appId: credentials.appId,
                channel: credentials.channelName,
                token: credentials.token.isEmpty ? nil : credentials.token,
                uid: credentials.uid
            ))
            status = "Connected"
            // Treat a connection as good enough to show the picture: the first-frame
            // callback can fire before it is registered, and waiting on it alone would
            // leave the overlay up forever.
            isReady = true

            // The agent arrives a beat later; the microphone waits for it.
            await awaitAgentJoined()
            agentReady = true
        } catch {
            await stop()
            status = "Could not connect"
            errorMessage = error.localizedDescription
        }
    }

    /// Wait for the ConvoAI agent to join the channel.
    ///
    /// `connect()` returning only means this device joined; the agent is started
    /// asynchronously by ConvoAI after `/api/session` returns, measured at a second or
    /// two later. Audio published during that window is dropped, and the symptom is a
    /// channel that connects but never answers.
    ///
    /// Polled rather than subscribed. `AvatarPlayerEvent` carries no user-joined event,
    /// and `getUserInfo(byUid:)` answers from the SDK's own member table, which is
    /// enough for a question asked once at startup.
    ///
    /// It matches the agent uid the server minted: the avatar's own publishing endpoint
    /// is in the channel too and generally joins first, so keying off "some remote user
    /// exists" matches the wrong one. A timeout also lets us through — an agent that
    /// never joins is the server's problem, and the picture still works.
    private func awaitAgentJoined(timeout: TimeInterval = 20) async {
        guard agentUid > 0, let engine = player?.getNativeClient() as? AgoraRtcEngineKit else { return }
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            var error: AgoraErrorCode = .noError
            if engine.getUserInfo(byUid: agentUid, withError: &error) != nil, error == .noError {
                return
            }
            try? await Task.sleep(nanoseconds: 300_000_000)
        }
    }

    /// Publish the microphone.
    ///
    /// Unlike the Web client, the native `publishAudio()` opens the device itself —
    /// permission and routing belong to the SDK here, so there is no track to hand it.
    func publishMic() async {
        guard !micActive, player?.isConnected == true else { return }
        do {
            try await player?.publishAudio()
            micActive = true
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func unpublishMic() async {
        guard micActive else { return }
        await player?.unpublishAudio()
        micActive = false
    }

    private func handle(event: AvatarPlayerEvent) {
        switch event {
        case .stalled:
            // Reconnect on a stalled stream, so the picture does not freeze.
            Task { try? await player?.reconnect() }
        default:
            break
        }
    }

    /// Disconnect and stop the session.
    ///
    /// Explicit rather than left to the channel's idle timeout: that waits a minute, and
    /// the minute is billed.
    func stop() async {
        await player?.disconnect()
        player = nil
        provider = nil
        await AgentClient.stopSession(baseURL: baseURL, sessionId: sessionId)
        sessionId = ""
        agentUid = 0
        credentials = nil
        avatar = nil
        // Dropped so re-entering builds a fresh view for the next session; the old one
        // owns a render loop that would otherwise keep running behind it.
        avatarView = nil
        isReady = false
        agentReady = false
        micActive = false
        hasStarted = false
        hasConnected = false
    }
}
