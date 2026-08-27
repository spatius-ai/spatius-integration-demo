# Direct Mode — Flutter Client

Flutter client for [Direct Mode](../../README.md). The client drives the avatar directly via the AvatarKit SDK. Pre-recorded PCM audio files are sent to the avatar for testing.

## Prerequisites

- Flutter 3.10.0+ / Dart 3.0.0+
- Physical device or emulator/simulator (iOS 16+, Android API 24+)
- App ID and Session Token from [Spatius Developer Platform](https://app.spatius.ai)

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

3. In the app, enter your **App ID** and **Session Token**, select region, then tap **Initialize SDK**.

4. On the Playground screen, select a character and tap **Start** to connect. Choose an audio file on the right to send it to the avatar.

   > Audio only reaches the avatar once the connection is up — tapping a clip
   > before **Start** just tells you to connect first.

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

## How it works

```
Pre-recorded PCM audio → controller.send(chunk, end: isLast)
                              ↓
                    AvatarKit SDK (WebSocket to Spatius)
                              ↓
                    Avatar renders animation
```

## About the bundled audio

The clips shipped with this demo are samples, not a constraint. `send()` takes
any PCM16 audio at the configured sample rate — live microphone capture, a TTS
stream, or audio from your own pipeline all go through the same call. Files are
bundled so the demo runs with nothing but an App ID and a Session Token.

See [Direct Mode](../../README.md#about-the-audio-in-these-demos) for the full picture.

