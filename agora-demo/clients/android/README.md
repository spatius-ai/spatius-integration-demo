# Agora Demo — Android Client

Android client for the [Agora demo](../../servers/python/README.md). The avatar joins the
call itself: audio travels on an RTC track and the motion rides along encoded in the
video stream, so this app feeds it nothing — it joins a channel and renders what arrives.

## Prerequisites

- JDK 17+ and the Android SDK (API 36)
- A device or emulator on API 24+
- The Agora demo server running (see `../../servers/python/`), with its `.env` filled
  in. It refuses to start otherwise, so if it is up it is configured.
- The AvatarKit artifacts in your local Maven repository (`~/.m2`): this app depends on
  `ai.spatius:avatarkit-rtc:1.0.0`, which is resolved from `mavenLocal()`.

## Setup

1. Point the app at the server. Copy the lines you need from
   [`local.properties.example`](./local.properties.example) into `local.properties`
   (which is not committed):

   ```properties
   sdk.dir=/Users/you/Library/Android/sdk
   RTC_MODE_URL=http://192.168.1.10:8790
   ```

   `RTC_MODE_URL` is baked in at build time as `BuildConfig.RTC_MODE_URL`, and it is
   the only thing this app is configured with. Use `10.0.2.2` on the emulator — that is
   the host machine's loopback as seen from inside it — and the LAN address the server
   prints on startup on a real device. Left out, it defaults to `http://10.0.2.2:8790`.

2. Build and install:

   ```bash
   ./gradlew assembleRelease
   adb install -r app/build/outputs/apk/release/app-release.apk
   ```

   Release rather than debug: rendering an avatar is the whole point, and a debug build
   drops the frame rate far enough that the SDK looks slow. It is signed with the debug
   key so it installs — replace that with your own before shipping anything.

3. Run it. The app opens on the room: pick a character from the **Avatar** button and
   talk.

## Agora, not LiveKit

This client lives in the Agora demo and nowhere else, and the reason is the SDK: the
Android RTC SDK ships the Agora stack alone, with no LiveKit client linked in. The
[LiveKit demo](../../../livekit-demo) next door is therefore web-only.

## Configuration

There is none on the device beyond the server's address. The Spatius and Agora
credentials, the conversation language and the default avatar all live in the server's
`.env`; the voice lives on the agent published in Agora's console. Nothing is typed
into the app — copying secrets across apps on a phone is miserable, and the IME mangles
them: auto-capitalization and autocorrect leave damage that is invisible afterwards.

Two of those settings fail **silently** when they do not match the console:

| Setting | Where | Symptom when wrong |
|---|---|---|
| `AGORA_AVATAR_SAMPLE_RATE` | the server's `.env` | the avatar joins, publishes, and never makes a sound |
| `ASR_VENDOR` / `ASR_MODEL` | the server's `agora.py` | speech transcribes to nothing, or to "Yeah." and "Hello?" |

## How it works

```
RoomScreen  ──POST /api/session──►  server        (avatarId: the character picked)
                                      ↓
                             ConvoAI starts the agent,
                             Spatius joins as the avatar
                                      ↓
            ◄──────── Agora channel ────────►  agent + avatar
  mic ──publishAudio──►                  ◄── audio track + motion in video SEI
```

| File | What it does |
|---|---|
| `MainActivity.kt` | one screen, the room |
| `RoomScreen.kt` | avatar stage, character sheet, microphone |
| `AvatarRtcSession.kt` | session lifecycle: create, load, connect, publish, stop |
| `AgentClient.kt` | the two calls to the demo server |

The microphone is the only control, and that is the path rather than a simplification
for the phone — the Web client has nothing else either. Nothing is driven from this app,
so there is nothing to pause, resume or interrupt: those act on local playback, and a
live RTC track has none.

Switching character restarts the session: the avatar is chosen when the ConvoAI agent
starts, so it cannot be swapped on a running one.

> ⚠️ **Billing starts when the room opens** and runs until the session is stopped. The
> app stops it on the way out; the channel's own idle timeout is only a backstop, and
> the minute it waits is billed.
