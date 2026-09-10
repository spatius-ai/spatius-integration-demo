# Direct Mode — Flutter Client

Flutter client for [Direct Mode](../../README.md). The microphone is captured on the
device and sent to the Direct Mode server, which runs ASR, LLM and TTS and streams the
assistant's reply back as PCM. That PCM drives the avatar — the client keeps the Motion
Server connection itself, which is what makes it Direct Mode.

```
mic PCM16 ──ws──► server (ASR → LLM → TTS) ──ws──► assistant PCM16
                                                        ↓
                                          controller.send(chunk, end: isLast)
                                                        ↓
                                       AvatarKit SDK (WebSocket to Spatius)
                                                        ↓
                                            Avatar renders animation
```

The app holds no credentials. On launch it fetches `GET /api/config` from the server,
asks it for a Session Token, initializes the SDK, and opens on the playground — there
is no configuration screen.

## Prerequisites

- Flutter 3.10.0+ / Dart 3.0.0+
- Physical device or emulator/simulator (iOS 16+, Android API 24+)
- A running [Direct Mode server](../../servers/python/README.md)

## Configuration

One setting, in `lib/config.dart`:

```dart
const directModeUrl = 'http://localhost:8090';
```

- The iOS Simulator shares the Mac's network, so the default works there.
- The Android emulator reaches the host machine at `http://10.0.2.2:8090`.
- A physical device cannot reach your computer's `localhost` — use the LAN address the
  server prints at startup (`http://192.168.x.x:8090`).

Everything else — App ID, API key, avatar, region, conversation language, voice — lives
in the server's `.env`. Nothing is entered on the device and nothing is stored there.

## Setup

1. Install dependencies:

   ```bash
   flutter pub get
   ```

2. Run on iOS:

   ```bash
   cd ios && pod install && cd ..
   flutter run
   ```

   > **Running on a physical iOS device?** This project ships with the Spatius
   > signing identity, which your Apple developer account cannot use. Open
   > `ios/Runner.xcworkspace` in Xcode, go to **Runner → Signing & Capabilities**,
   > set **Team** to your own account, and change **Bundle Identifier** to
   > something unique (for example `com.yourname.avatarDemo`). The iOS Simulator
   > needs no signing, so it is the fastest way to try the demo.

   Run on Android:

   ```bash
   flutter run
   ```

3. Start the server first — the app cannot boot without it, and shows the reason and a
   **Retry** if it is unreachable.

4. The app opens on the playground with the server's configured avatar loading. Use
   **Characters** in the app bar to pick another, or to enter a custom ID. Tap
   **Start** to connect, then tap the microphone and talk — or type a line and tap
   **Say**.

   > Audio only reaches the avatar once the connection is up.

## Keeping the app usable after unplugging

`flutter run` installs a **debug** build, which needs the Flutter tooling on your
Mac to stay attached; relaunching it from the home screen after disconnecting
fails. Build a release version to get an app that runs on its own:

```bash
flutter build ios --release        # or: flutter run --release
```

## Troubleshooting

**iOS build fails with `Cannot find 'kDefaultOpusBitrate' in scope`, `Type 'AudioCodec' (aka 'OpaquePointer') has no member 'pcm'`, or similar missing-symbol errors.**

The AvatarKit xcframework was not pulled into `ios/Pods`, so the module can't be
imported and every symbol from it appears to be missing. A stale CocoaPods state
is the usual cause. Reinstall the pods:

```bash
rm -rf ios/Pods ios/Podfile.lock ios/.symlinks
flutter clean && flutter pub get
cd ios && pod install && cd ..
```

**The avatar answers itself.**

Microphone capture uses `VOICE_COMMUNICATION` on Android rather than the default `MIC`
source: the hardware echo canceller only engages on that one. Without it the avatar's
own voice comes back in through the microphone and reaches the agent as user speech.

**`sessionTokenInvalid`.**

The token is minted by the server from its own `SPATIUS_API_KEY`, and the device never
sees the key — check that key and `SPATIUS_APP_ID` in the server's `.env`.

## About the audio

The microphone is one source, not a constraint. `send()` takes any PCM16 audio at the
configured sample rate — live capture, a TTS stream, a file read off disk, or audio
from your own pipeline all go through the same call.

See [Direct Mode](../../README.md#about-the-audio-in-these-demos) for the full picture.
