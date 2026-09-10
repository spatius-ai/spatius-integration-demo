import SwiftUI
import AvatarKit

@main
struct AvatarKitBackendModeDemoApp: SwiftUI.App {
    var body: some SwiftUI.Scene {
        WindowGroup {
            NavigationStack {
                RootView()
            }
        }
    }
}

/// The whole boot path.
///
/// There is no configuration screen: in Backend Mode the server holds the Motion
/// Server connection and every credential with it, and its address is fixed at build
/// time in `Config.backendModeURL`. So the only startup work is reading
/// `/api/config` and initializing the SDK with what comes back.
///
/// No session token is involved: this SDK instance renders what arrives over the
/// WebSocket and never authenticates against Spatius itself.
private struct RootView: View {
    @State private var serverConfig: BackendClient.ServerConfig?
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if let serverConfig {
                PlaygroundView(serverConfig: serverConfig)
            } else if let errorMessage {
                bootError(errorMessage)
            } else {
                VStack(spacing: 10) {
                    ProgressView()
                    Text("Starting…").font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .task { await boot() }
    }

    /// The address is fixed at build time, so a failure here is not something the
    /// user can type their way out of — the fix is in `Config.swift` or in the
    /// server's `.env`, and this says which.
    private func bootError(_ message: String) -> some View {
        VStack(spacing: 12) {
            Text("Cannot reach the Backend Mode server")
                .font(.headline)
                .multilineTextAlignment(.center)
            Text(message)
                .font(.caption.monospaced())
                .foregroundColor(.red)
                .multilineTextAlignment(.center)
            Text("Trying \(Config.backendModeURL) — set backendModeURL in Config.swift, "
                 + "or run ../../start.sh to fill in this machine's LAN address. Start "
                 + "the server with: cd servers/python && uv run python -m app.main")
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("Retry") {
                errorMessage = nil
                Task { await boot() }
            }
            .buttonStyle(.borderedProminent)
        }
        .padding(32)
    }

    private func boot() async {
        guard serverConfig == nil else { return }
        do {
            let config = try await BackendClient.fetchConfig(baseURL: Config.backendModeURL)
            AvatarSDK.initialize(
                appID: config.appID,
                configuration: Configuration(
                    region: config.region,
                    audioFormat: AudioFormat(sampleRate: config.inputSampleRate),
                    drivingServiceMode: .backend,
                    logLevel: .all
                )
            )
            serverConfig = config
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
