import SwiftUI

struct ControlPanelView: View {
    @ObservedObject var viewModel: AvatarViewModel

    @State private var backendTextInput: String = ""

    var body: some View {
        VStack(spacing: 0) {
            // Status
            HStack(spacing: 16) {
                Label(viewModel.backendConnected ? "connected" : viewModel.backendConnecting ? "connecting..." : "disconnected",
                      systemImage: "server.rack")
                Label(viewModel.conversationState, systemImage: "bubble.left.and.bubble.right")
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            .padding(.vertical, 6)

            if let errorMessage = viewModel.errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundColor(.red)
                    .padding(.horizontal, 12)
                    .padding(.bottom, 4)
            }

            Divider()

            VStack(spacing: 0) {
                HStack(spacing: 8) {
                    if !viewModel.backendConnected {
                        Button(viewModel.backendConnecting ? "Connecting..." : "Connect") {
                            viewModel.backendConnect()
                        }
                        .buttonStyle(.bordered)
                        .disabled(viewModel.backendConnecting)
                    } else {
                        Button("Disconnect") {
                            viewModel.backendDisconnect()
                        }
                        .buttonStyle(.bordered)
                    }
                    Button("Interrupt") { viewModel.interrupt() }
                        .buttonStyle(.bordered)
                }
                .padding(.vertical, 8)

                Divider()

                VStack(alignment: .leading, spacing: 8) {
                    Button(viewModel.backendMicActive ? "Stop Mic" : "Start Mic") {
                        if viewModel.backendMicActive {
                            viewModel.backendStopMic()
                        } else {
                            viewModel.backendStartMic()
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(viewModel.backendMicActive ? .red : .blue)
                    .padding(.horizontal, 16)

                    HStack(spacing: 8) {
                        TextField("Type a message...", text: $backendTextInput)
                            .textFieldStyle(.roundedBorder)
                            .font(.subheadline)
                            .onSubmit { sendHostText() }
                        Button("Send") { sendHostText() }
                            .buttonStyle(.bordered)
                            .disabled(backendTextInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                    .padding(.horizontal, 16)

                    Text("Connects to \(Config.backendModeURL)/ws/agent")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 4)
                }
                .padding(.vertical, 8)
            }
        }
    }

    private func sendHostText() {
        let text = backendTextInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        viewModel.backendSendText(text)
        backendTextInput = ""
    }
}
