import SwiftUI
import AvatarKit

/// Which scene the playground opens in.
///
/// Named DemoScene, not Scene: SwiftUI already has a `Scene` protocol, and an
/// app's `body: some Scene` resolves to whichever is in scope — shadowing it
/// breaks the entry point with an error that points nowhere near this file.
enum DemoScene: String {
    case sample
    case realtime
}

/// Which language the realtime conversation runs in.
enum Lang: String {
    case en
    case zh
}

/// The configuration screen.
///
/// Credentials are shown, never typed. Copying five secrets across apps on a phone is
/// miserable, and the keyboard mangles them — autocapitalization and autocorrect leave
/// damage that is invisible afterwards. They belong in the server's `.env`, which the
/// user is already sitting in front of, and one copy there covers every client.
///
/// So the only field here is the server's address: a phone cannot reach the dev
/// machine's localhost, and the server prints its LAN address on startup.
struct ConfigurationView: View {
    @AppStorage("baseURL") private var baseURL: String = "http://localhost:8090"
    @AppStorage("scene") private var sceneRaw: String = DemoScene.sample.rawValue
    @AppStorage("language") private var languageRaw: String = Lang.en.rawValue

    @State private var serverConfig: BackendClient.ServerConfig?
    @State private var checking = false
    @State private var statusText = ""
    @State private var errorMessage: String?
    @State private var navigateToPlayground = false
    @State private var sessionToken = ""

    /// The credentials each scene needs, named as they appear in the server's `.env`.
    private let sampleKeys = ["SPATIUS_API_KEY", "SPATIUS_APP_ID"]
    private var realtimeKeys: [String] {
        sampleKeys + ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"]
    }

    private var scene: DemoScene { DemoScene(rawValue: sceneRaw) ?? .sample }
    private var language: Lang { Lang(rawValue: languageRaw) ?? .en }
    private var isRealtime: Bool { scene == .realtime }

    /// Which credentials this scene still needs, as the server reports them.
    private var missing: [String] {
        guard let config = serverConfig else { return [] }
        return isRealtime ? config.missingRealtime : config.missingSample
    }
    private var ready: Bool { serverConfig != nil && missing.isEmpty && !checking }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                Text("The client drives the avatar directly. Pick where its audio comes from.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 16)

                // The scene goes first: it decides which credentials are required below.
                VStack(alignment: .leading, spacing: 8) {
                    sectionTitle("Scene")
                    HStack(spacing: 10) {
                        sceneCard("Pre-recorded audio", "Play a bundled clip", selected: !isRealtime) {
                            sceneRaw = DemoScene.sample.rawValue
                        }
                        sceneCard("Realtime audio", "Talk to the avatar", selected: isRealtime) {
                            sceneRaw = DemoScene.realtime.rawValue
                        }
                    }
                    .padding(.horizontal, 16)
                }

                // The server's address. The one thing that cannot come from the server
                // itself, since this is how the phone finds it.
                VStack(alignment: .leading, spacing: 8) {
                    sectionTitle("Server address")
                    TextField("http://192.168.x.x:8090", text: $baseURL)
                        .font(.system(size: 14))
                        .textFieldStyle(.roundedBorder)
                        .textInputAutocapitalization(.never)
                        .disableAutocorrection(true)
                        .keyboardType(.URL)
                        .padding(.horizontal, 12)
                    Text("The server prints this on startup. Use localhost in the simulator, "
                         + "the LAN address on a real device.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 16)
                    HStack {
                        Button(checking ? "Checking…" : "Check connection") {
                            Task { await check() }
                        }
                        .disabled(checking)
                        .buttonStyle(.bordered)
                        if !statusText.isEmpty {
                            Text(statusText).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .padding(.horizontal, 16)
                }

                // Credentials, shown but not editable — see the note on this view.
                VStack(alignment: .leading, spacing: 8) {
                    sectionTitle("Credentials")
                    if serverConfig == nil {
                        Text("Check the connection to read what the server has.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 16)
                    } else {
                        ForEach(isRealtime ? realtimeKeys : sampleKeys, id: \.self) { key in
                            HStack {
                                Text(key).font(.caption)
                                Spacer()
                                let filled = !missing.contains(key)
                                Text(filled ? "configured" : "missing")
                                    .font(.caption)
                                    .foregroundColor(filled ? .green : .red)
                            }
                            .padding(.horizontal, 16)
                        }
                        Text("Set these in the server's .env — they never reach this device. "
                             + "Editing them there covers every client at once.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 16)
                    }
                }

                // Only the realtime scene reaches an agent, so this appears with it.
                //
                // Chosen here rather than inside the scene: recognition, synthesis and
                // the persona are all fixed when the agent session is built, so it
                // cannot be switched on a running conversation.
                if isRealtime {
                    VStack(alignment: .leading, spacing: 8) {
                        sectionTitle("Conversation language")
                        Picker("Language", selection: $languageRaw) {
                            Text("English").tag(Lang.en.rawValue)
                            Text("中文").tag(Lang.zh.rawValue)
                        }
                        .pickerStyle(.segmented)
                        .padding(.horizontal, 12)
                        Text("Sets speech recognition, the voice, and the assistant's persona.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 16)
                    }
                }

                if let errorMessage {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundColor(.red)
                        .padding(.horizontal, 16)
                }

                Button(action: { Task { await start() } }) {
                    HStack {
                        if checking { ProgressView().tint(.white) }
                        Text("Start")
                    }
                    .font(.headline)
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(ready ? Color.blue : Color.gray)
                    .cornerRadius(10)
                }
                .disabled(!ready)
                .padding(.horizontal, 16)

                if serverConfig != nil && !missing.isEmpty {
                    Text("Fill in \(missing.joined(separator: ", ")) in the server's .env first.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 16)
                }

                // One guide per credential set, in the order the keys are listed
                // above. The Spatius one is always there; LiveKit's is added by the
                // realtime scene rather than replacing it, since that scene needs both.
                VStack(alignment: .leading, spacing: 8) {
                    // Plain Text, not sectionTitle: that helper carries its own
                    // horizontal padding, which would double up inside this stack.
                    Text("Where to find these")
                        .font(.headline)
                        .foregroundStyle(.secondary)
                    Link(destination: URL(string: "https://app.spatius.ai")!) {
                        Image("api-key-guide")
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                            .cornerRadius(10)
                    }
                    Text("App ID and API Key")
                        .font(.caption2)
                        .foregroundStyle(.secondary)

                    if isRealtime {
                        // Two steps: open Settings, then look at API keys.
                        Link(destination: URL(string: "https://cloud.livekit.io")!) {
                            VStack(spacing: 6) {
                                Image("livekit-guide-1")
                                    .resizable()
                                    .aspectRatio(contentMode: .fit)
                                    .cornerRadius(10)
                                Image("livekit-guide-2")
                                    .resizable()
                                    .aspectRatio(contentMode: .fit)
                                    .cornerRadius(10)
                            }
                        }
                        Text("LiveKit URL, API Key and Secret")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.horizontal, 16)
            }
            .padding(.vertical, 16)
        }
        .navigationTitle("Direct Mode")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            // The server holds the one shared copy of the credentials, so read what it
            // has on entry rather than waiting for the user to press anything.
            await check()
        }
        .navigationDestination(isPresented: $navigateToPlayground) {
            if let config = serverConfig {
                PlaygroundView(
                    serverConfig: config,
                    scene: scene,
                    language: language,
                    sessionToken: sessionToken
                )
            }
        }
    }

    private func check() async {
        guard !baseURL.isEmpty else { return }
        checking = true
        statusText = "Checking…"
        do {
            serverConfig = try await BackendClient.fetchConfig(baseURL: baseURL)
            statusText = "Server online."
        } catch {
            serverConfig = nil
            statusText = error.localizedDescription
        }
        checking = false
    }

    /// Mint a token, initialize the SDK, then move to the playground.
    ///
    /// The API key never reaches this device — the server exchanges the one in its own
    /// `.env` for a short-lived Session Token, which is what the SDK gets.
    private func start() async {
        guard let config = serverConfig else { return }
        checking = true
        errorMessage = nil
        do {
            let token = try await BackendClient.fetchSessionToken(baseURL: baseURL)
            AvatarSDK.initialize(
                appID: config.appID,
                configuration: Configuration(
                    region: config.region,
                    audioFormat: AudioFormat(sampleRate: config.sampleRate),
                    drivingServiceMode: .direct,
                    logLevel: .all
                )
            )
            AvatarSDK.sessionToken = token
            sessionToken = token
            navigateToPlayground = true
        } catch {
            errorMessage = error.localizedDescription
        }
        checking = false
    }

    private func sectionTitle(_ text: String) -> some View {
        Text(text)
            .font(.headline)
            .foregroundStyle(.secondary)
            .padding(.horizontal, 16)
    }

    private func sceneCard(
        _ title: String,
        _ subtitle: String,
        selected: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.subheadline).fontWeight(.semibold)
                Text(subtitle).font(.caption2).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(selected ? Color.blue.opacity(0.10) : Color.clear)
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(selected ? Color.blue : Color.gray.opacity(0.4),
                            lineWidth: selected ? 2 : 1)
            )
            .cornerRadius(10)
        }
        .buttonStyle(.plain)
    }
}
