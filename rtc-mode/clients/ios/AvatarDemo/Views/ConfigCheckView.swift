import SwiftUI

/// Which language the conversation runs in.
enum Lang: String {
    case en
    case zh
}

/// The configuration screen.
///
/// Credentials are shown, never typed. Copying secrets across apps on a phone is
/// miserable, and the keyboard mangles them — autocapitalization and autocorrect leave
/// damage that is invisible afterwards. They belong in the server's `.env`, which the
/// user is already sitting in front of, and one copy there covers every client.
///
/// So the only field here is the server's address: a phone cannot reach the dev
/// machine's localhost, and the server prints its LAN address on startup.
///
/// There is one scene, unlike the other two modes: in RTC Mode the avatar joins the
/// call itself, and everything it says arrives over the channel — there is no
/// pre-recorded path to choose.
struct ConfigCheckView: View {
    @AppStorage("baseURL") private var baseURL: String = Config.rtcModeURL
    @AppStorage("language") private var languageRaw: String = Lang.en.rawValue

    @State private var serverConfig: ServerConfig?
    @State private var checking = false
    @State private var statusText = ""
    @State private var errorMessage: String?
    @State private var navigateToRoom = false

    /// The credentials this mode needs, named as they appear in the server's `.env`.
    ///
    /// Agora rather than LiveKit, and not a choice: the iOS RTC SDK ships the Agora
    /// stack alone, so this app asks the server for an Agora session whatever its own
    /// `TRANSPORT` is set to. The Web clients can switch; this one cannot.
    private let requiredKeys = [
        "SPATIUS_APP_ID",
        "SPATIUS_API_KEY",
        "AGORA_APP_ID",
        "AGORA_APP_CERTIFICATE",
        "AGORA_PIPELINE_ID",
    ]

    private var language: Lang { Lang(rawValue: languageRaw) ?? .en }

    /// Which credentials are still missing, as the server reports them for the Agora
    /// transport.
    private var missing: [String] { serverConfig?.missingAgora ?? [] }
    private var ready: Bool { serverConfig != nil && missing.isEmpty && !checking }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                Text("The avatar joins the call itself — audio and motion both arrive "
                     + "over RTC, and nothing streams through the server.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 16)

                // The server's address. The one thing that cannot come from the server
                // itself, since this is how the phone finds it.
                VStack(alignment: .leading, spacing: 8) {
                    sectionTitle("Server address")
                    TextField("http://192.168.x.x:8790", text: $baseURL)
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
                        ForEach(requiredKeys, id: \.self) { key in
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
                             + "The server signs the token this app joins with, and starts "
                             + "the agent that brings the avatar into the channel.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 16)
                    }
                }

                // Chosen here rather than inside the room: recognition, the voice and the
                // persona are all fixed when the agent session is built, so none of them
                // can be switched on a running conversation.
                VStack(alignment: .leading, spacing: 8) {
                    sectionTitle("Conversation language")
                    Picker("Language", selection: $languageRaw) {
                        Text("English").tag(Lang.en.rawValue)
                        Text("中文").tag(Lang.zh.rawValue)
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal, 12)
                    Text("Sets speech recognition and the assistant's persona. The voice "
                         + "comes from the agent published in the Agora console.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 16)
                }

                if let errorMessage {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundColor(.red)
                        .padding(.horizontal, 16)
                }

                // The modifiers live inside `label:` — applied to the Button itself they
                // enlarge what is drawn without enlarging what is tappable, and the
                // button ends up responding only along the text.
                Button {
                    navigateToRoom = true
                } label: {
                    Text("Start")
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

                guides
            }
            .padding(.vertical, 16)
        }
        .navigationTitle("RTC Mode")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            // The server holds the one shared copy of the credentials, so read what it
            // has on entry rather than waiting for the user to press anything.
            await check()
        }
        .navigationDestination(isPresented: $navigateToRoom) {
            RoomView(baseURL: baseURL, language: language)
        }
    }

    /// Where each credential comes from, in the order the keys are listed above.
    ///
    /// Split into its own property because the type checker times out trying to infer
    /// one expression this large.
    private var guides: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Where to find these")
                .font(.headline)
                .foregroundStyle(.secondary)

            Link(destination: URL(string: "https://app.spatius.ai")!) {
                Image("api-key-guide")
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .cornerRadius(10)
            }
            Text("Spatius App ID and API Key")
                .font(.caption2)
                .foregroundStyle(.secondary)

            // Four steps, in the order the Agora keys are listed: pick the project under
            // Projects → take the App ID and certificate → find the agent under Agents →
            // publish it and take the pipeline id.
            Link(destination: URL(string: "https://console.agora.io")!) {
                VStack(spacing: 6) {
                    ForEach(1...4, id: \.self) { step in
                        Image("agora-guide-\(step)")
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                            .cornerRadius(10)
                    }
                }
            }
            Text("Agora App ID, App Certificate and the agent (pipeline) id")
                .font(.caption2)
                .foregroundStyle(.secondary)

            // The two settings that fail silently. Neither is entered anywhere on this
            // screen — the sample rate is in the server's .env and the recognition ids
            // are in its agora.py — but both have to match the console, and a mismatch
            // reports nothing at either end.
            Link(destination: URL(string: "https://console.agora.io")!) {
                VStack(spacing: 6) {
                    Image("agora-voice-guide")
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .cornerRadius(10)
                    Image("agora-guide-5")
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .cornerRadius(10)
                }
            }
            Text("The voice lives on the agent. Its sample rate must equal "
                 + "AGORA_AVATAR_SAMPLE_RATE in the server's .env — the avatar does not "
                 + "resample, and a mismatch is silent.")
                .font(.caption2)
                .foregroundStyle(.secondary)

            Link(destination: URL(string: "https://console.agora.io")!) {
                Image("agora-asr-guide")
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .cornerRadius(10)
            }
            Text("Recognition must match the vendor, model and credential id hard-coded "
                 + "in the server's agora.py.")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 16)
    }

    private func check() async {
        guard !baseURL.isEmpty else { return }
        checking = true
        statusText = "Checking…"
        do {
            serverConfig = try await AgentClient.fetchConfig(baseURL: baseURL)
            statusText = "Server online."
        } catch {
            serverConfig = nil
            statusText = error.localizedDescription
        }
        checking = false
    }

    private func sectionTitle(_ text: String) -> some View {
        Text(text)
            .font(.headline)
            .foregroundStyle(.secondary)
            .padding(.horizontal, 16)
    }
}
