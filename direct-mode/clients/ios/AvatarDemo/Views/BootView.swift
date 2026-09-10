import SwiftUI
import AvatarKit

/// What is on screen while the server is being reached, and when it cannot be.
///
/// There is nothing to fill in — everything lives in the server's `.env`. On launch
/// this fetches `/api/config`, mints a Session Token, initializes the SDK, and hands
/// over to the playground. The API key never reaches the device.
struct BootView: View {
    @State private var serverConfig: BackendClient.ServerConfig?
    @State private var booting = true
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if let serverConfig {
                PlaygroundView(serverConfig: serverConfig)
            } else if booting {
                VStack(spacing: 16) {
                    ProgressView()
                    Text("Connecting to the Direct Mode server…")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
            } else {
                VStack(spacing: 16) {
                    Text("Cannot start")
                        .font(.title2.weight(.semibold))
                    Text(errorMessage ?? "Could not reach the Direct Mode server")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                    Text("Check that the server is running, that its .env is filled in, "
                         + "and that Config.directModeURL points at it.")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                        .multilineTextAlignment(.center)
                    Button("Retry") { Task { await boot() } }
                        .buttonStyle(.borderedProminent)
                }
                .padding(32)
            }
        }
        .task { await boot() }
    }

    /// Fetch the configuration, mint a token, initialize the SDK.
    ///
    /// The whole of the credential path in a Direct Mode app: the server exchanges the
    /// `SPATIUS_API_KEY` in its own `.env` for a short-lived Session Token, and that
    /// token is what the SDK gets.
    private func boot() async {
        booting = true
        errorMessage = nil
        do {
            let config = try await BackendClient.fetchConfig(baseURL: Config.directModeURL)
            let token = try await BackendClient.fetchSessionToken(baseURL: Config.directModeURL)
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
            serverConfig = config
        } catch {
            errorMessage = error.localizedDescription
        }
        booting = false
    }
}
