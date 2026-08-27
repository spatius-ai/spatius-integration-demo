import Foundation

enum Config {
    /// RTC Mode server base URL.
    ///
    /// The simulator runs on the host machine, so localhost reaches it directly. A
    /// physical device cannot — it needs the dev machine's LAN address, which the
    /// server prints on startup and also returns from `GET /health` as `lanUrl`. That
    /// is why the address is the one thing this app asks the user to type: everything
    /// else it needs, it reads from the server once it can reach it.
    static let rtcModeURL = "http://localhost:8790"
}
