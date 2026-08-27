# Direct Mode iOS Client

SwiftUI sample implementing the same avatar conversation pipeline as Web:

`VAD -> ASR (OpenAI) -> LLM (streaming) -> TTS (OpenAI) -> AvatarKit SDK`

## Requirements

- Xcode 16+
- iOS 16+
- Apple Silicon Mac (recommended for simulator rendering)

## Session Token (Manual)

Aligned with Android:

- Do not fetch token from local backend in this sample.
- Paste Session Token manually in UI.
- Token is validated when tapping `Start Conversation`.

- Token guide: `https://docs.spatius.ai/api-reference/api-reference#obtain-a-session-token`

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

Nothing to edit before building — the app collects everything on its first
screen and remembers it:

- **App ID**: https://app.spatius.ai/apps
- **Session Token**: https://docs.spatius.ai/api-reference/api-reference#obtain-a-session-token
- **Region**: `auto` lets the SDK pick the closest serving region

Then pick a character on the Playground screen, tap **Start** to connect, and
choose an audio clip to send. Audio only reaches the avatar once the connection
is up — tapping a clip before **Start** just tells you to connect first.

## Notes

- iOS `AvatarKit.xcframework` is downloaded automatically on first build from the configured release. Override `SPATIUS_AVATARKIT_IOS_URL` and `SPATIUS_AVATARKIT_IOS_CHECKSUM` only when testing a different release.
- If `sessionTokenInvalid` appears, check token type, token age, app/region match.

## Troubleshooting

**`error: There is no XCFramework found at '.../AvatarKit.xcframework'` on a clean checkout.**

The download runs as a build phase, but the framework dependency is resolved
before build phases execute, so the very first build can fail before the script
gets a chance to run. Build once more, or fetch it up front:

```bash
curl -L -o AvatarKit.xcframework.zip \
  https://github.com/spatius-ai/avatarkit-ios-release/releases/download/v1.3.2/AvatarKit_202608072023.zip
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

## About the bundled audio

The clips shipped with this demo are samples, not a constraint. `send()` takes
any PCM16 audio at the configured sample rate — live microphone capture, a TTS
stream, or audio from your own pipeline all go through the same call. Files are
bundled so the demo runs with nothing but an App ID and a Session Token.

See [Direct Mode](../../README.md#about-the-audio-in-these-demos) for the full picture.

