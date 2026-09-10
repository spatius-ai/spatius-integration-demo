/// The one setting this app has.
///
/// Everything else — the App ID, the API key, the avatar, the conversation language —
/// lives in the Direct Mode server's `.env`, and this app reads what it needs from
/// `GET /api/config` at launch. Credentials never reach the device.
///
/// A phone cannot reach the dev machine's `localhost`, so change this to the LAN
/// address the server prints at startup (`http://192.168.x.x:8090`) before running on
/// hardware. The Android emulator reaches the host at `http://10.0.2.2:8090`; the iOS
/// simulator shares the Mac's network, so the default works there.
const directModeUrl = 'http://localhost:8090';
