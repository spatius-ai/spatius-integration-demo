# Direct Mode Android Client

Kotlin + Compose sample implementing the same flow as Web / iOS: pre-recorded
PCM audio is streamed to the avatar and rendered as lip-sync.

`PCM chunk -> controller.send(chunk, end) -> AvatarKit SDK -> Avatar renders`

## Requirements

- Android Studio (latest stable)
- JDK 17
- Android API 24+
- arm64-v8a device (real device recommended)

## SDK Version

- Android AvatarKit: `ai.spatius:avatarkit:1.3.2`

## Configuration

Nothing has to be edited before building — the app collects everything on its
first screen and remembers it across launches:

- **App ID**: https://app.spatius.ai/apps
- **Avatar ID** (test avatars): https://app.spatius.ai/avatars/library
- **Session Token**: https://docs.spatius.ai/api-reference/api-reference#obtain-a-session-token
- **Region**: `auto` lets the SDK pick the closest serving region

To prefill those fields on a fresh install, copy the sample properties file:

```bash
cp local.properties.example local.properties
```

Values saved in the app take precedence from then on.

## Build

```bash
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ./gradlew :app:assembleDebug
```

Install with Android Studio or `adb install -r app/build/outputs/apk/debug/app-debug.apk`.

## Run Flow

1. Enter App ID, Avatar ID and Session Token, then tap **Initialize SDK**.
2. Wait for the avatar to finish loading.
3. Tap **Connect**.
4. Tap any clip under **Send Audio** to stream it to the avatar.

Audio only reaches the avatar once the connection is up — tapping a clip before
**Connect** just tells you to connect first.

## Stage Background

Uses local static asset:

- `app/src/main/res/drawable/avatar_bg.webp`

## Notes

- Bundled clips live in `app/src/main/assets/audio/` and are 16 kHz mono PCM16,
  matching the `AudioFormat(16000)` the demo initializes with. Sending audio at a
  different sample rate plays back at the wrong speed and breaks lip-sync.
- If you see `sessionTokenInvalid`, verify token type, expiration, app ID, and region.

## About the bundled audio

The clips shipped with this demo are samples, not a constraint. `send()` takes
any PCM16 audio at the configured sample rate — live microphone capture, a TTS
stream, or audio from your own pipeline all go through the same call. Files are
bundled so the demo runs with nothing but an App ID and a Session Token.

See [Direct Mode](../../README.md#about-the-audio-in-these-demos) for the full picture.

