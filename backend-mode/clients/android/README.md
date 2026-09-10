# Backend Mode — Android Client

Android client for [Backend Mode](../../README.md). All AI processing (ASR → LLM → TTS) runs on the **backend**; the client records audio or sends text, then renders the avatar response.

## Prerequisites

- Android Studio (latest stable)
- Physical device or emulator (minSdk 24)
- Backend Mode backend running (see `../../servers/python/`)

## Setup

1. Copy `local.properties.example` to `local.properties` and edit:

   ```properties
   BACKEND_MODE_URL=http://10.0.2.2:8765
   ```

   - **Emulator**: use `10.0.2.2` (Android's alias for host loopback)
   - **Physical device**: use your machine's LAN IP (e.g. `http://192.168.1.100:8765`)

   > **Tip**: Running `../../start.sh` auto-configures `local.properties` with the correct LAN IP. `BACKEND_MODE_URL` reaches the app as a `BuildConfig` field and is the only source for the address.

2. Open the project in Android Studio and sync Gradle.

3. Run on device/emulator.

## Boot flow

There is no configuration screen. The app starts, reads `/api/config` from the
backend, calls `AvatarSDK.initialize` with what comes back, and opens on the
playground with the character the backend nominates. Every credential and every
conversation option (language, region, voice) lives in the backend's `.env` — the only
thing set on this side is the backend address, because it is how the app finds the
backend at all. If the backend is unreachable the app shows the error and a **Retry**.

## How it works

```
User (mic/text) → Android App → WebSocket /ws/agent → Backend
                                                          ↓
                                              ASR → LLM → TTS + Backend Mode bridge
                                                          ↓
         Android App ← JSON { audio PCM + frames } ← Backend
                ↓
       controller.yieldAudioData(audioData) + yieldFramesData(frames)
                ↓
           Avatar renders with synced audio
```

## Project Structure

```
app/src/main/java/ai/spatius/avatarkit/backendmodedemo/
├── MainActivity.kt          # Entry point: boot, then the playground
├── data/
│   ├── BackendConfig.kt     # Reads GET /api/config
│   └── Characters.kt        # Default test avatars
├── viewmodel/
│   └── AvatarViewModel.kt   # Boot, WebSocket, mic capture, avatar control
└── ui/
    ├── CharacterPicker.kt   # Character list + custom id
    ├── DesignSystem.kt      # Shared colors and spacing
    ├── screens/
    │   ├── BootScreen.kt        # Spinner, and the error + retry state
    │   └── PlaygroundScreen.kt  # Main UI: avatar view, status, controls
    └── theme/
        ├── Color.kt
        └── Theme.kt
```
