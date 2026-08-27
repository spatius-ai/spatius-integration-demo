import SwiftUI

/// The room: the avatar and the microphone.
///
/// Thinner than the other two modes' playgrounds, and the reason is the mode itself:
/// the avatar is in the call, so there is nothing here that drives it. No clip list —
/// there is no pre-recorded scene. No pause, resume or interrupt — those act on local
/// playback, and there is none: the audio is a live RTC track. The Web client's room is
/// the same shape, for the same reason.
struct RoomView: View {
    let baseURL: String
    let language: Lang

    @StateObject private var session = AvatarRtcSession()
    @Environment(\.dismiss) private var dismiss

    @State private var showCharacters = false
    @State private var selectedCharacterId = ""

    var body: some View {
        VStack(spacing: 16) {
            stage
            controls
            Spacer(minLength: 0)
        }
        .padding(.vertical, 16)
        .navigationTitle("RTC Mode")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Avatar") { showCharacters = true }
            }
        }
        .sheet(isPresented: $showCharacters) { characterSheet }
        .task {
            await session.prepare(
                baseURL: baseURL,
                language: language.rawValue,
                avatarId: selectedCharacterId
            )
        }
        .onDisappear {
            // A session bills continuously from creation, so leaving the screen has to
            // stop it rather than leaving it to the channel's idle timeout.
            Task { await session.stop() }
        }
    }

    // MARK: - Stage

    private var stage: some View {
        ZStack {
            Color.black.opacity(0.05)
            AvatarStage(session: session)

            if !session.isReady {
                VStack(spacing: 10) {
                    ProgressView()
                    Text(session.status)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if let percent = session.downloadPercent {
                        Text("\(percent)%")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            // Nothing over the avatar here. The other two modes put pause and interrupt
            // there because they drive playback; in RTC Mode the avatar is in the call
            // and there is no local playback to act on — closing the microphone is the
            // only control, and it lives below.
        }
        .frame(maxWidth: .infinity)
        .frame(height: 360)
        .cornerRadius(12)
        .padding(.horizontal, 16)
    }

    // MARK: - Controls

    /// The microphone and nothing else.
    ///
    /// Same as the Web client: in RTC Mode nothing is driven from this screen, so
    /// closing the microphone is the only control there is.
    private var controls: some View {
        VStack(spacing: 12) {
            micButton
            Text(micStateText)
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            if let errorMessage = session.errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundColor(.red)
                    .multilineTextAlignment(.center)
            }
            Text("RTC Mode is the one path where the avatar joins the call itself: "
                 + "audio travels on an RTC track and the motion rides along encoded in "
                 + "the video stream. Nothing is driven from this screen, and nothing "
                 + "streams through the server — it only issues the credentials to join.")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .padding(.top, 4)
        }
        .padding(.horizontal, 16)
    }

    private var micButton: some View {
        Button {
            Task {
                if session.micActive {
                    await session.unpublishMic()
                } else {
                    await session.publishMic()
                }
            }
        } label: {
            Image(systemName: session.micActive ? "stop.fill" : "mic.fill")
                .font(.system(size: 26))
                .foregroundColor(.white)
                .frame(width: 84, height: 84)
                .background(session.micActive ? Color.red : Color.blue)
                .clipShape(Circle())
        }
        .buttonStyle(.plain)
        // The agent joins a beat after the channel connects. No ring marks the moment
        // it comes alive, unlike the Web client: on a phone the button and the line of
        // text under it are the whole screen, so "Waiting for the agent to join…"
        // turning into "Tap to start talking" is already impossible to miss.
        .disabled(!session.agentReady)
    }

    private var micStateText: String {
        if !session.isReady { return session.status }
        if !session.agentReady { return "Waiting for the agent to join…" }
        if session.micActive {
            return "Listening — just talk, the agent decides when your turn ends."
        }
        return "Tap to start talking."
    }

    // MARK: - Characters

    /// A sheet rather than a list beside the avatar: a phone has no room for both, and
    /// the avatar is what the screen is for.
    ///
    /// Switching restarts the session — the avatar is chosen when the ConvoAI agent is
    /// started, so it cannot be swapped on a running one.
    private var characterSheet: some View {
        NavigationStack {
            List(defaultCharacters) { character in
                Button {
                    showCharacters = false
                    Task { await switchCharacter(to: character.id) }
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
            }
            .navigationTitle("Avatar")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Close") { showCharacters = false }
                }
            }
        }
        .presentationDetents([.medium])
    }

    private func switchCharacter(to id: String) async {
        guard id != selectedCharacterId else { return }
        selectedCharacterId = id
        // Stopped before starting: the old session bills until it is, and the new avatar
        // needs an agent started against it.
        await session.stop()
        await session.prepare(baseURL: baseURL, language: language.rawValue, avatarId: id)
    }
}
