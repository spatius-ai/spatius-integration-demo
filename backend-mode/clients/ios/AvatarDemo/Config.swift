import Foundation

enum Config {
    /// Host backend base URL — auto-configured by start.sh
    /// Simulator: localhost. Physical device: LAN IP.
    static let backendModeURL = "http://localhost:8765"
}
