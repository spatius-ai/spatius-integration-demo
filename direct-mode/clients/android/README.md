# Direct Mode Android Client

Kotlin + Compose sample. The microphone is captured on the device and sent to the
Direct Mode server, which runs ASR, LLM and TTS and streams the assistant's reply
back as PCM. That PCM drives the avatar:

`mic PCM -> server (ASR/LLM/TTS) -> assistant PCM -> controller.send(chunk, end) -> Avatar renders`

The app holds no credentials. On launch it fetches `GET /api/config` from the server,
asks it for a Session Token, initializes the SDK, and opens on the playground — there
is no configuration screen.

## Requirements

- Android Studio (latest stable)
- JDK 17
- Android API 24+
- arm64-v8a device (real device recommended)
- A running [Direct Mode server](../../servers/python/README.md)

## SDK Version

- Android AvatarKit: `ai.spatius:avatarkit:1.3.3`

## Configuration

One setting, and it is the server's address:

```bash
cp local.properties.example local.properties   # then add your sdk.dir
```

```properties
DIRECT_MODE_URL=http://10.0.2.2:8090
```

- `http://10.0.2.2:8090` — the emulator's route to the host machine (the default)
- `http://192.168.1.10:8090` — a physical device on the same LAN; use the address the
  server prints at startup, because a phone cannot reach your computer's `localhost`

Everything else — App ID, API key, avatar, region, conversation language, voice —
lives in the server's `.env`. Nothing is entered on the device and nothing is stored
there.

## Build

```bash
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ./gradlew :app:assembleDebug
```

Install with Android Studio or `adb install -r app/build/outputs/apk/debug/app-debug.apk`.

## Run Flow

1. Start the server first — the app cannot boot without it, and says so if it is
   unreachable, with a **Retry**.
2. The app opens on the playground with the server's configured avatar loading.
   Use **Characters** in the toolbar to pick another, or to enter a custom ID.
3. Tap **Start** to connect.
4. Tap the microphone and talk. The transcript appears below; **Stop** and **Pause**
   sit over the avatar.

Audio only reaches the avatar once the connection is up.

## Stage Background

Uses local static asset:

- `app/src/main/res/drawable/avatar_bg.webp`

## Notes

- The whole path is 16 kHz mono PCM16, matching the `AudioFormat(16000)` the app
  initializes with from `/api/config`. Sending audio at a different sample rate plays
  back at the wrong speed and breaks lip-sync.
- Microphone capture uses `VOICE_COMMUNICATION` rather than the default `MIC` source:
  the hardware echo canceller only engages on that one. Without it the avatar's own
  voice comes back in through the microphone and it answers itself.
- If you see `sessionTokenInvalid`, check the server's `SPATIUS_API_KEY` and
  `SPATIUS_APP_ID` — the token is minted there, and the device never sees the key.
- If the app cannot start, the error is almost always the address: check
  `DIRECT_MODE_URL` against what the server printed, and that the server is still up.

## About the audio

The microphone is one source, not a constraint. `send()` takes any PCM16 audio at the
configured sample rate — live capture, a TTS stream, a file read off disk, or audio
from your own pipeline all go through the same call.

See [Direct Mode](../../README.md#about-the-audio-in-these-demos) for the full picture.
