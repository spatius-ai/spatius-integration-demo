# Agora Demo — iOS Client

iOS client for the [Agora demo](../../servers/python/README.md). The avatar joins the call
itself: audio travels on an RTC track and the motion rides along encoded in the video
stream, so this app feeds it nothing — it joins a channel and renders what arrives.

## Prerequisites

- Xcode 16+
- **A physical device** (iOS 16+). Not the simulator — see below.
- The Agora demo server running (see `../../servers/python/`), with its `.env` filled
  in. It refuses to start otherwise, so if it is up it is configured.

## Setup

1. Point the app at the server. `Config.serverURL` in `AvatarDemo/Config.swift` is the
   only thing this app is configured with:

   ```swift
   static let serverURL = "http://localhost:8790"   // replace with your machine's LAN address, e.g. http://192.168.x.x:8790
   ```

   This app only runs on a physical device, and a device cannot reach the dev machine's
   `localhost` — use the LAN address the server prints on startup (also returned by
   `GET /health` as `lanUrl`).

2. Generate the project and open it:

   ```bash
   DEVELOPMENT_TEAM=YOUR_TEAM_ID xcodegen generate
   open AvatarDemo.xcodeproj
   ```

   Everything else comes from Swift Package Manager on first build: `AvatarKitRTC`
   brings in AvatarKit and the Agora SDK. Unlike the other demos there is no
   `AvatarKit.xcframework` to download — declaring both would embed the framework
   twice and fail with *"Multiple commands produce …/AvatarKit.framework"*.

   > **Signing.** Set **Team** under AvatarDemo → Signing & Capabilities to your own
   > account, and change the bundle identifier to something unique.

3. Run it. The app opens on the room: pick a character from the **Avatar** button and
   talk.

### Device only

`EXCLUDED_ARCHS[sdk=iphonesimulator*]: arm64` in `project.yml` is not a preference:
neither the Agora SDK nor the AvatarKit build that `AvatarKitRTC` depends on ships a
simulator slice, so there is nothing to link against there. Build and run on hardware.

## Agora, not LiveKit

This client lives in the Agora demo and nowhere else, and the reason is the SDK:
`avatarkit-ios-rtc` ships the Agora stack alone, with no LiveKit client linked in. The
[LiveKit demo](../../../livekit-demo) next door is therefore web-only.

This is also why these two demos are the only ones with an RTC transport at all. Direct
Mode has no RTC in it — the client holds the Motion Server connection directly. Backend
Mode uses LiveKit as an ASR/LLM/TTS pipeline with **no LiveKit room**, and its clients
never link an RTC SDK.

## Configuration

There is none on the device beyond the server's address. The Spatius and Agora
credentials, the conversation language and the default avatar all live in the server's
`.env`; the voice lives on the agent published in Agora's console. Nothing is typed
into the app — copying secrets across apps on a phone is miserable, and the keyboard
mangles them: autocapitalization and autocorrect leave damage that is invisible
afterwards.

Two of those settings fail **silently** when they do not match the console:

| Setting | Where | Symptom when wrong |
|---|---|---|
| `AGORA_AVATAR_SAMPLE_RATE` | the server's `.env` | the avatar joins, publishes, and never makes a sound |
| `ASR_VENDOR` / `ASR_MODEL` | the server's `agora.py` | speech transcribes to nothing, or to "Yeah." and "Hello?" |

## How it works

```
Room screen  ──POST /api/session──►  server        (avatarId: the character picked)
                                       ↓
                              ConvoAI starts the agent,
                              Spatius joins as the avatar
                                       ↓
             ◄──────── Agora channel ────────►  agent + avatar
   mic ──publishAudio──►                  ◄── audio track + motion in video SEI
```

The microphone is the only control, and that is the path rather than a simplification
for the phone — the Web client has nothing else either. Nothing is driven from this app,
so there is nothing to pause, resume or interrupt: those act on local playback, and a
live RTC track has none.

> ⚠️ **Billing starts when the room opens** and runs until the session is stopped. The
> app stops it on the way out; the channel's own idle timeout is only a backstop, and
> the minute it waits is billed.
