# Agora Demo — iOS Client

iOS client for the [Agora demo](../../servers/python/README.md). The avatar joins the call
itself: audio travels on an RTC track and the motion rides along encoded in the video
stream, so this app feeds it nothing — it joins a channel and renders what arrives.

## Prerequisites

- Xcode 16+
- **A physical device** (iOS 16+). Not the simulator — see below.
- The Agora demo server running (see `../../servers/python/`), with its credentials
  filled in.

## Setup

1. Generate the project and open it:

   ```bash
   DEVELOPMENT_TEAM=YOUR_TEAM_ID xcodegen generate
   open AvatarDemo.xcodeproj
   ```

   Everything else comes from Swift Package Manager on first build: `AvatarKitRTC`
   brings in AvatarKit and the Agora SDK. Unlike the other two modes there is no
   `AvatarKit.xcframework` to download — declaring both would embed the framework
   twice and fail with *"Multiple commands produce …/AvatarKit.framework"*.

2. Set the server address in the app. The default is `http://localhost:8790`, which
   only works in the simulator; on a device use the LAN address the server prints on
   startup (also returned by `GET /health` as `lanUrl`).

   > **Signing.** Set **Team** under AvatarDemo → Signing & Capabilities to your own
   > account, and change the bundle identifier to something unique.

### Device only

`EXCLUDED_ARCHS[sdk=iphonesimulator*]: arm64` in `project.yml` is not a preference:
neither the Agora SDK nor the AvatarKit build that `AvatarKitRTC` depends on ships a
simulator slice, so there is nothing to link against there. Build and run on hardware.

## Agora, not LiveKit

This client lives in the Agora demo and nowhere else, and the reason is the SDK:
`avatarkit-ios-rtc` ships the Agora stack alone, with no LiveKit client linked in. The
[LiveKit demo](../../../livekit-demo) next door is therefore web-only. The app still sends
`transport: "agora"` with every session request (see `Services/AgentClient.swift`), a
leftover from when one server served both transports; this server ignores it.

This is also why these two demos are the only ones with an RTC transport at all. Direct
Mode has no RTC in it — the client holds the Motion Server connection directly. Backend
Mode uses LiveKit as an ASR/LLM/TTS pipeline with **no LiveKit room**, and its clients
never link an RTC SDK.

## Credentials

Shown on the config screen, never typed. Copying secrets across apps on a phone is
miserable, and the keyboard mangles them — autocapitalization and autocorrect leave
damage that is invisible afterwards. They live in the server's `.env`, and one copy
there covers every client on every platform.

The screen reads `GET /api/config` and reports each key as *configured* or *missing*,
using the server's own list, so a key that is missing names itself rather
than surfacing later as a failed session. The guide images below the list point at
where each one comes from in the Agora console.

Two of those settings are not on this screen at all, because nothing here can set them,
and both fail **silently** when they do not match the console:

| Setting | Where | Symptom when wrong |
|---|---|---|
| `AGORA_AVATAR_SAMPLE_RATE` | the server's `.env` | the avatar joins, publishes, and never makes a sound |
| `ASR_RESOURCE_ZH` / `ASR_RESOURCE_EN` | the server's `agora.py` | speech transcribes to nonsense or to nothing |

## How it works

```
Config screen ──GET /api/config──►  server        (what is configured, what is missing)
              ──POST /api/session─►  server        (transport: agora)
                                       ↓
                              ConvoAI starts the agent,
                              Spatius joins as the avatar
                                       ↓
Room screen  ◄──────── Agora channel ────────►  agent + avatar
   mic ──publishAudio──►                  ◄── audio track + motion in video SEI
```

The microphone is the only control, and that is the mode rather than a simplification
for the phone — the Web client has nothing else either. Nothing is driven from this app,
so there is nothing to pause, resume or interrupt: those act on local playback, and a
live RTC track has none. There is one scene, too, since everything the avatar says
arrives over the channel and there is no pre-recorded path to choose.

> ⚠️ **Billing starts when the room opens** and runs until the session is stopped. The
> app stops it on the way out; the channel's own idle timeout is only a backstop, and
> the minute it waits is billed.
