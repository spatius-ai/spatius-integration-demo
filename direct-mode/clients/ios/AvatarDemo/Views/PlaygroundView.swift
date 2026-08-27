import SwiftUI
import AvatarKit

/// One row of the status bar: an SDK callback and what it last reported.
private struct StatusRow: Identifiable {
    let id = UUID()
    let label: String
    let callback: String
    let help: String
    let value: String?
}

/// The playground, laid out for a phone.
///
/// Same parts as the Web client and in the same order, folded into one column: the
/// avatar with its playback controls, then Start, then the status bar, then whatever
/// drives the avatar for this scene. What the Web version puts in a left-hand list —
/// the characters — is a sheet here, opened from the toolbar; a phone has no room for
/// a permanent sidebar, and the avatar is what the screen is for.
struct PlaygroundView: View {
    let serverConfig: BackendClient.ServerConfig
    let scene: DemoScene
    let language: Lang
    let sessionToken: String

    @StateObject private var viewModel = AvatarViewModel()
    @State private var selectedCharacterId: String = ""
    @State private var selectedCharacterName: String = ""
    @State private var avatarViewId: Int = 0
    @State private var isLoadingAvatar = false
    @State private var loadError: String?
    @State private var loadProgress: Double = 0
    @State private var showAudioHint = false
    @State private var showCharacters = false
    @State private var helpRow: StatusRow?
    @State private var typed = ""

    private var isConnected: Bool { viewModel.isConnected }

    var body: some View {
        // The page itself does not scroll. Everything the pre-recorded scene needs is
        // on screen at once — tapping a clip and watching the avatar answer are the
        // two halves of one action, and putting the list below the fold meant
        // scrolling down to start playback and back up to see it.
        VStack(spacing: 12) {
            avatarStage

            // Above the status bar: connecting is the first thing to do once a
            // character is loaded, and the status below reports whether it worked.
            if viewModel.avatar != nil {
                Button {
                    viewModel.start()
                } label: {
                    // Inside the label, not modifiers on the Button: a plain
                    // `Button("Start")` is only tappable across its text, and
                    // padding applied outside enlarges the drawing while leaving
                    // the hit area on the few characters in the middle.
                    Text(isConnected ? "Connected" : "Start")
                        .font(.headline)
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(isConnected ? Color.gray : Color.blue)
                        .cornerRadius(10)
                }
                .disabled(isConnected)
                .padding(.horizontal, 16)
            }

            // What drives the avatar, and the only thing that differs between the
            // two scenes: a list of clips to send, or a microphone whose replies
            // come back from the agent. Both end at controller.send().
            if viewModel.avatar != nil {
                if scene == .realtime {
                    // The realtime panel is one control and a transcript that grows,
                    // so it scrolls on its own with the status bar above it.
                    ScrollView {
                        VStack(spacing: 12) {
                            statusBar
                            realtimePanel
                        }
                    }
                } else {
                    // Side by side, each scrolling within its own column: the clips
                    // are what gets tapped and the status is what gets read while the
                    // avatar answers, so neither may push the other off screen.
                    HStack(alignment: .top, spacing: 10) {
                        ScrollView { statusBar }
                            .frame(maxWidth: .infinity)
                        ScrollView { audioFileSection }
                            .frame(maxWidth: .infinity)
                    }
                    .padding(.horizontal, 12)
                }
            }

            if let loadError {
                Text(loadError)
                    .font(.caption)
                    .foregroundColor(.red)
                    .padding(.horizontal, 16)
            }
        }
        .padding(.vertical, 12)
        .navigationTitle(selectedCharacterName.isEmpty ? "Playground" : selectedCharacterName)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Characters") { showCharacters = true }
                    .disabled(isLoadingAvatar)
            }
        }
        .sheet(isPresented: $showCharacters) {
            characterSheet
        }
        .toast($viewModel.toast)
        .alert("Sending audio", isPresented: $showAudioHint) {
            Button("Got it", role: .cancel) {}
        } message: {
            Text(audioSourceHint)
        }
        .alert(item: $helpRow) { row in
            Alert(
                title: Text(row.label),
                message: Text("\(row.callback)\n\n\(row.help)"),
                dismissButton: .cancel(Text("Got it"))
            )
        }
        .task {
            viewModel.configureRealtime(
                url: serverConfig.realtimeURL,
                language: language.rawValue
            )
            // Whatever the server nominates, so the playground is never empty.
            if selectedCharacterId.isEmpty {
                let fallback = defaultCharacters.first { $0.id == serverConfig.avatarID }
                loadCharacter(
                    id: serverConfig.avatarID,
                    name: fallback?.name ?? "Avatar"
                )
            }
        }
        .onDisappear { viewModel.close() }
    }

    // MARK: - Stage

    private var avatarStage: some View {
        ZStack {
            Color.black
            if let avatar = viewModel.avatar {
                AvatarViewRepresentable(avatar: avatar) { viewModel.setAvatarController($0) }
                    .id(avatarViewId)
            }
            if isLoadingAvatar {
                VStack(spacing: 8) {
                    ProgressView().tint(.white)
                    Text(loadProgress > 0 ? "Downloading avatar… \(Int(loadProgress * 100))%" : "Loading avatar…")
                        .foregroundStyle(.white)
                        .font(.caption)
                }
            } else if viewModel.avatar == nil {
                Text("Pick a character to get started").foregroundStyle(.gray)
            }

            // Over the avatar, since that is what they act on. Which pair shows
            // follows the conversation state; in idle neither does.
            //
            // Pinned to the two bottom corners rather than centred as a pair: the
            // avatar's face is in the middle, and a row of buttons across it is the
            // one place they cannot go. Interrupt keeps the left corner in both
            // states — it does the same thing either way, and moving it would make
            // the two swap places on every pause.
            if viewModel.conversationState != "\(ConversationState.idle)" {
                let paused = viewModel.conversationState == "\(ConversationState.paused)"
                VStack {
                    Spacer()
                    HStack {
                        stageButton(icon: "stop.fill", tint: .red) { viewModel.interrupt() }
                        Spacer()
                        stageButton(
                            icon: paused ? "play.fill" : "pause.fill",
                            tint: .blue
                        ) {
                            if paused { viewModel.resume() } else { viewModel.pause() }
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.bottom, 18)
                }
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: 300)
        .cornerRadius(12)
        .padding(.horizontal, 16)
    }

    /// One of the two controls over the avatar.
    ///
    /// The colour is the button rather than a tint over the render, and the white ring
    /// is what keeps it readable against a light avatar and a dark background alike.
    private func stageButton(
        icon: String,
        tint: Color,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 22, weight: .bold))
                .foregroundColor(.white)
                .frame(width: 56, height: 56)
                .background(tint)
                .clipShape(Circle())
                .overlay(Circle().stroke(Color.white.opacity(0.85), lineWidth: 3))
                .shadow(color: .black.opacity(0.35), radius: 8, y: 4)
        }
        .buttonStyle(.plain)
    }

    // MARK: - Status bar

    /// The six SDK callbacks worth watching, in the order they first fire.
    private var statusRows: [StatusRow] {
        [
            StatusRow(
                label: "Download",
                callback: "AvatarManager.load(id, onProgress)",
                help: "Model download progress, 0-100%. Only fires on a cache miss — a second load of the same avatar resolves straight away.",
                value: isLoadingAvatar ? "\(Int(loadProgress * 100))%" : "complete"
            ),
            StatusRow(
                label: "First frame",
                callback: "AvatarView.onFirstRendering",
                help: "Fires once, when the avatar has actually been drawn. This — not \"connected\" — is the moment to take a loading overlay down.",
                value: viewModel.avatar != nil ? "rendered" : "waiting"
            ),
            StatusRow(
                label: "Connection",
                callback: "AvatarController.onConnectionState",
                help: "The Motion Server connection: disconnected → connecting → connected, or failed. Audio sent before connected is dropped.",
                value: viewModel.connectionState
            ),
            StatusRow(
                label: "Conversation",
                callback: "AvatarController.onConversationState",
                help: "Playback state: idle, playing or paused. The controls over the avatar follow this.",
                value: viewModel.conversationState
            ),
            StatusRow(
                label: "Frame rate",
                callback: "AvatarController.onFrameRateInfo",
                help: "Rolling render rate over a 2-second window. Off by default and free while off; this demo enables it via frameRateMonitorEnabled.",
                value: viewModel.fps.map { "\($0) fps" }
            ),
            StatusRow(
                label: "Error",
                callback: "AvatarController.onError",
                help: "SDK failures — an expired session token, an unrecognised avatar id, a lost connection. Worth surfacing rather than leaving to the console.",
                value: viewModel.errorMessage ?? "none"
            ),
        ]
    }

    private var statusBar: some View {
        VStack(spacing: 6) {
            ForEach(statusRows) { row in
                HStack {
                    Text(row.label).font(.caption)
                    Button {
                        helpRow = row
                    } label: {
                        Image(systemName: "questionmark.circle")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                    Spacer()
                    Text(row.value ?? "—")
                        .font(.caption)
                        .foregroundStyle(
                            row.label == "Error" && row.value != "none" ? .red :
                                (row.value == nil ? .secondary : .primary)
                        )
                }
            }
        }
        .padding(10)
        .background(Color.gray.opacity(0.08))
        .cornerRadius(10)
    }

    // MARK: - Pre-recorded scene

    private var audioFileSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Text("Audio Files").font(.subheadline).fontWeight(.semibold)
                Button { showAudioHint = true } label: {
                    Image(systemName: "questionmark.circle")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                Spacer()
            }

            ForEach(viewModel.audioFiles, id: \.self) { file in
                Button {
                    viewModel.sendAudioFile(file)
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "waveform").font(.caption)
                        Text(viewModel.currentlyPlayingFile == file ? "..." : file)
                            .font(.caption)
                            .lineLimit(1)
                        Spacer()
                    }
                    .padding(.vertical, 8)
                    .padding(.horizontal, 10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(Color.gray.opacity(0.35), lineWidth: 1)
                    )
                }
                .buttonStyle(.plain)
                // Stays tappable while disconnected so the guard can explain why
                // nothing would play, rather than the row going dead.
                .disabled(viewModel.isSendingAudio)
            }
        }
    }

    // MARK: - Realtime scene

    // Split into named parts rather than one expression: the type checker gives up on
    // a stack this deep and reports only that it "cannot type-check in reasonable
    // time", with no line to work from.
    private var realtimePanel: some View {
        VStack(spacing: 10) {
            Text("Microphone")
                .font(.subheadline)
                .fontWeight(.semibold)
                .frame(maxWidth: .infinity, alignment: .leading)

            micButton
            Text(micStateText).font(.caption).foregroundStyle(.secondary)
            sayRow
            transcriptList

            Text("The conversation runs on the backend — ASR, LLM and TTS — and its speech "
                 + "arrives here as PCM over a WebSocket. That audio goes to controller.send(), "
                 + "exactly like the pre-recorded clips do.")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 16)
    }

    /// No ring here, unlike the Web client: on a phone the microphone is the only
    /// control on screen once the realtime scene is open, so there is nothing for a
    /// hint to disambiguate it from.
    private var micButton: some View {
        Button {
            Task { await viewModel.toggleMic() }
        } label: {
            Image(systemName: viewModel.micOn ? "stop.fill" : "mic.fill")
                .font(.system(size: 26))
                .foregroundColor(.white)
                .frame(width: 84, height: 84)
                .background(viewModel.micOn ? Color.red : Color.blue)
                .clipShape(Circle())
        }
        .buttonStyle(.plain)
        .disabled(viewModel.agentConnecting)
    }

    /// A way to try the scene without a microphone — a device with no input, or a
    /// quick check that the agent replies.
    private var sayRow: some View {
        HStack(spacing: 8) {
            TextField("…or type a line to speak", text: $typed)
                .font(.system(size: 14))
                .textFieldStyle(.roundedBorder)
            Button("Say") {
                let line = typed
                typed = ""
                Task { await viewModel.say(line) }
            }
            .buttonStyle(.bordered)
            .disabled(typed.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
    }

    @ViewBuilder
    private var transcriptList: some View {
        if !viewModel.transcript.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                ForEach(Array(viewModel.transcript.enumerated()), id: \.offset) { _, turn in
                    let who = turn.role == "user" ? "You" : "Avatar"
                    Text("\(who)  \(turn.text)")
                        .font(.caption)
                        .foregroundStyle(turn.role == "user" ? Color.primary : Color.blue)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }

    private var micStateText: String {
        if viewModel.agentConnecting { return "Starting the agent…" }
        if viewModel.micOn { return "Listening — just talk, the agent decides when your turn ends." }
        if viewModel.agentReady { return "Microphone off." }
        return "Tap to start talking."
    }

    // MARK: - Characters

    private var characterSheet: some View {
        NavigationStack {
            List(defaultCharacters) { character in
                Button {
                    showCharacters = false
                    loadCharacter(id: character.id, name: character.name)
                } label: {
                    HStack(spacing: 10) {
                        Circle()
                            .fill(Color.blue)
                            .frame(width: 32, height: 32)
                            .overlay(
                                Text(String(character.name.prefix(1)))
                                    .foregroundStyle(.white)
                                    .font(.caption.bold())
                            )
                        Text(character.name)
                        Spacer()
                        if selectedCharacterId == character.id {
                            Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                        }
                    }
                }
                .buttonStyle(.plain)
                .disabled(isLoadingAvatar)
            }
            .navigationTitle("Characters")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Close") { showCharacters = false }
                }
            }
        }
    }

    private func loadCharacter(id: String, name: String) {
        guard !id.isEmpty else { return }
        selectedCharacterId = id
        selectedCharacterName = name
        isLoadingAvatar = true
        loadError = nil
        loadProgress = 0
        viewModel.close()
        viewModel.avatar = nil

        Task {
            do {
                let avatar = try await AvatarManager.shared.load(id: id, onProgress: { progress in
                    self.loadProgress = progress.fractionCompleted
                })
                viewModel.avatar = avatar
                avatarViewId += 1
                isLoadingAvatar = false
            } catch {
                loadError = error.localizedDescription
                isLoadingAvatar = false
            }
        }
    }
}
