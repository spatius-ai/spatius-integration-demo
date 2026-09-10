# Agora Demo

[![@spatius/avatarkit](https://img.shields.io/npm/v/%40spatius%2Favatarkit?label=%40spatius%2Favatarkit)](https://www.npmjs.com/package/@spatius/avatarkit)
[![@spatius/avatarkit-rtc](https://img.shields.io/npm/v/%40spatius%2Favatarkit-rtc?label=%40spatius%2Favatarkit-rtc)](https://www.npmjs.com/package/@spatius/avatarkit-rtc)

## What this demo is

The avatar **joins the call itself**. Agora's Conversational AI Engine (ConvoAI) hosts
the conversation, Spatius joins the same channel as the avatar publisher, and the
client renders what arrives over the channel: audio on an RTC track, motion encoded into
the video stream. Nothing streams through the demo server — it only signs channel
credentials and asks ConvoAI to start the agent.

```
Direct    client ──audio──►  Motion Server                    (client drives)
Backend   client ──mic───►  server ──►  Motion Server         (server drives)
Agora     client ◄────  Agora channel  ────►  agent + avatar  (neither does)
```

**Choose this demo when:**
- You want the conversation hosted for you, with ASR / LLM / TTS and the voice
  configured on an agent in Agora's console
- You need the iOS or Android client — the mobile RTC SDKs ship the Agora stack alone

**Choose the [LiveKit demo](../livekit-demo/) when:**
- You want the conversation to run on your own machine, on LiveKit Agents, with models
  routed by LiveKit Inference

## Layout

```
agora-demo/
├── servers/python/      Flask server: holds the config, signs tokens, starts and
│                        stops the ConvoAI agent
└── clients/
    ├── web/             vue · react · vanilla · nextjs-direct · nextjs-iframe
    ├── ios/             SwiftUI, on a physical device
    └── android/         Jetpack Compose
```

## Quick Start

Everything this demo is configured with lives in the server's `.env` — the Spatius and
Agora credentials, the conversation language, and (in the Agora console) the voice.
Nothing is entered on a client, so the server goes first:

```bash
cd servers/python
cp .env.example .env    # Spatius App ID + API Key, Agora App ID + certificate + pipeline id
uv sync
uv run python server.py
```

It refuses to start while a required key is missing, and names the ones it is waiting
on. Then a client, in a second terminal:

```bash
cd clients/web/vue      # or react, vanilla, nextjs-direct, nextjs-iframe
pnpm install
pnpm dev
```

The page opens straight on the playground: choose a character and talk. If the server
is not up it says so, with a retry.

The mobile clients read the same server, but they cannot reach this machine's
localhost — point them at the LAN address the server prints on startup. See
[`clients/ios`](./clients/ios/README.md) and
[`clients/android`](./clients/android/README.md).

The server's [README](./servers/python/README.md) covers the Agora console setup (App
Certificate, publishing the agent, the sample rate), the API, and the ways a session can
fail without an error.

## Where settings live

| | Where |
|---|---|
| Spatius App ID / API Key / region / default avatar | `servers/python/.env` |
| Agora App ID / certificate / pipeline id / sample rate | `servers/python/.env` |
| Conversation language (`CONVERSATION_LANGUAGE`) | `servers/python/.env` |
| ASR, LLM, TTS and the voice | the published agent in Agora's console |
| The demo server's address | web: `VITE_`/`NEXT_PUBLIC_DEMO_SERVER_URL` (see each client's `.env.example`) · Android: `RTC_MODE_URL` in `local.properties` · iOS: `Config.swift` |
| The character | picked in the playground, and the only thing a client sends |

## Ports

The two RTC demos share their ports, so run one of them at a time:

| | Port |
|---|---|
| server | 8790 (`RTC_SERVER_PORT`) |
| react / vue / vanilla | 5190 / 5191 / 5192 |
| nextjs-direct / nextjs-iframe | 3020 / 3021 (iframe content on 5198) |
