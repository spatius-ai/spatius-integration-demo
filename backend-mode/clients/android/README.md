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

   > **Tip**: Running `../../start.sh` auto-configures `local.properties` with the correct LAN IP. The client fetches App ID and region from the backend `/api/config` endpoint.

2. Open the project in Android Studio and sync Gradle.

3. Run on device/emulator.

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
├── MainActivity.kt          # Entry point, initializes SDK
├── data/
│   └── Characters.kt        # Default test avatars
├── viewmodel/
│   └── AvatarViewModel.kt   # WebSocket, mic capture, avatar control
└── ui/
    ├── screens/
    │   └── PlaygroundScreen.kt   # Main UI: avatar view, controls, character list
    └── theme/
        ├── Color.kt
        └── Theme.kt
```
