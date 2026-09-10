# Direct Mode iOS Client

SwiftUI sample. The microphone is captured on the device and sent to the Direct Mode
server, which runs ASR, LLM and TTS and streams the assistant's reply back as PCM.
That PCM drives the avatar:

`mic PCM -> server (ASR/LLM/TTS) -> assistant PCM -> controller.send(chunk, end) -> Avatar renders`

The app holds no credentials. On launch it fetches `GET /api/config` from the server,
asks it for a Session Token, initializes the SDK, and opens on the playground — there
is no configuration screen.

## Requirements

- Xcode 16+
- iOS 16+
- Apple Silicon Mac (recommended for simulator rendering)
- A running [Direct Mode server](../../servers/python/README.md)

## Quick Start

```bash
git clone https://github.com/spatius-ai/spatius-integration-demo.git
cd spatius-integration-demo/direct-mode/clients/ios
brew install xcodegen
xcodegen generate
open AvatarDemo.xcodeproj
```

> **Running on a physical device?** The generated project carries the Spatius
> signing identity, which your Apple developer account cannot use. In Xcode go to
> **AvatarDemo → Signing & Capabilities**, set **Team** to your own account, and
> change **Bundle Identifier** to something unique (for example
> `com.yourname.avatarDemo`). The Simulator needs no signing.

## SDK Version

- iOS AvatarKit: prebuilt `AvatarKit.xcframework`, downloaded by the build script from the configured official release

## Configuration

One setting, in `AvatarDemo/Config.swift`:

```swift
static let directModeURL = "http://localhost:8090"
```

The Simulator shares the Mac's network, so the default works there. A physical device
cannot reach your computer's `localhost` — use the LAN address the server prints at
startup (`http://192.168.x.x:8090`).

Everything else — App ID, API key, avatar, region, conversation language, voice —
lives in the server's `.env`. Nothing is entered on the device and nothing is stored
there.

## Run Flow

1. Start the server first — the app cannot boot without it, and says so if it is
   unreachable, with a **Retry**.
2. The app opens on the playground with the server's configured avatar loading. Use
   **Characters** in the toolbar to pick another, or to enter a custom ID.
3. Tap **Start** to connect.
4. Tap the microphone and talk. The transcript appears below; interrupt and pause
   sit over the avatar.

Audio only reaches the avatar once the connection is up.

## Notes

- The whole path is 16 kHz mono PCM16, matching the `AudioFormat(sampleRate:)` the app
  initializes with from `/api/config`.
- iOS `AvatarKit.xcframework` is downloaded automatically on first build from the configured release. Override `SPATIUS_AVATARKIT_IOS_URL` and `SPATIUS_AVATARKIT_IOS_CHECKSUM` only when testing a different release.
- If `sessionTokenInvalid` appears, check the server's `SPATIUS_API_KEY` and
  `SPATIUS_APP_ID` — the token is minted there, and the device never sees the key.
- If the app cannot start, the error is almost always the address: check
  `directModeURL` against what the server printed, and that the server is still up.

## Troubleshooting

**`error: There is no XCFramework found at '.../AvatarKit.xcframework'` on a clean checkout.**

The download runs as a build phase, but the framework dependency is resolved
before build phases execute, so the very first build can fail before the script
gets a chance to run. Build once more, or fetch it up front:

```bash
curl -L -o AvatarKit.xcframework.zip \
  https://github.com/spatius-ai/avatarkit-ios-release/releases/download/v1.3.4/AvatarKit_202608311739.zip
unzip -q AvatarKit.xcframework.zip
```

**`dyld: Library not loaded: @rpath/AvatarKit.framework/AvatarKit` when launching on device.**

AvatarKit is a dynamic framework and has to ship inside the app bundle. The
project embeds it (`embed: true` in `project.yml`); if you edited that file,
make sure the setting survived and regenerate with `xcodegen generate`.

**Building for the Simulator from the command line.**

The bundled simulator slice is arm64-only, so pass the architecture explicitly:

```bash
xcodebuild -project AvatarDemo.xcodeproj -scheme AvatarDemo \
  -sdk iphonesimulator -arch arm64 build CODE_SIGNING_ALLOWED=NO
```

## About the audio

The microphone is one source, not a constraint. `send()` takes any PCM16 audio at the
configured sample rate — live capture, a TTS stream, a file read off disk, or audio
from your own pipeline all go through the same call.

See [Direct Mode](../../README.md#about-the-audio-in-these-demos) for the full picture.
