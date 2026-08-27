import SwiftUI

enum ToastKind {
    case error
    case warning

    var background: Color {
        switch self {
        case .error: return Color(red: 0.70, green: 0.15, blue: 0.12)
        case .warning: return Color(red: 0.54, green: 0.35, blue: 0.0)
        }
    }
}

struct ToastMessage: Equatable {
    let text: String
    var kind: ToastKind = .error
    /// Repeated identical failures must still re-trigger the animation, so the
    /// message carries its own identity rather than relying on text equality.
    let id = UUID()

    static func == (lhs: ToastMessage, rhs: ToastMessage) -> Bool { lhs.id == rhs.id }
}

/// Mirrors the web demos' Toast: SDK errors and blocked actions surface here
/// instead of only reaching a caption label.
struct ToastView: View {
    let message: ToastMessage

    var body: some View {
        Text(message.text)
            .font(.caption)
            .foregroundStyle(.white)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(message.kind.background)
            .cornerRadius(10)
            .padding(.horizontal, 16)
            .transition(.move(edge: .top).combined(with: .opacity))
    }
}

extension View {
    /// Presents `message` at the top of the screen and clears it after a beat.
    func toast(_ message: Binding<ToastMessage?>) -> some View {
        overlay(alignment: .top) {
            if let current = message.wrappedValue {
                ToastView(message: current)
                    .task(id: current.id) {
                        try? await Task.sleep(nanoseconds: 4_000_000_000)
                        withAnimation { message.wrappedValue = nil }
                    }
            }
        }
        .animation(.easeInOut(duration: 0.2), value: message.wrappedValue)
    }
}
