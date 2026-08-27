# Backend Mode — Flutter Client

Flutter client for [Backend Mode](../../README.md). All AI processing (ASR → LLM → TTS) runs on the **backend**; the client records audio or sends text, then renders the avatar response.

## Prerequisites

- Flutter 3.10.0+ / Dart 3.0.0+
- Physical device or emulator/simulator (iOS 16+, Android API 24+)
- Backend Mode backend running (see `../../servers/python/`)

## Setup

1. Install dependencies:

   ```bash
   flutter pub get
   ```

2. Edit `lib/config.dart` with your backend URL:

   ```dart
   static const String backendModeURL = 'http://localhost:8765';   // iOS simulator
   // static const String backendModeURL = 'http://10.0.2.2:8765';    // Android emulator
   // static const String backendModeURL = 'http://192.168.x.x:8765';  // physical device
   ```

   > **Tip:** Run `../../start.sh` to auto-configure `backendModeURL` from the backend `.env`. The client fetches App ID and region from the backend `/api/config` endpoint.

3. Run on iOS:

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

## How it works

```
User (mic/text) → Flutter App → WebSocket /ws/agent → Backend
                                                           ↓
                                               ASR → LLM → TTS + Backend Mode bridge
                                                           ↓
           Flutter App ← JSON { audio PCM + frames } ← Backend
                ↓
    controller.yieldAudioData() + yieldAnimations()
                ↓
           Avatar renders
```
