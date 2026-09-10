# LiveKit Demo

[![@spatius/avatarkit](https://img.shields.io/npm/v/%40spatius%2Favatarkit?label=%40spatius%2Favatarkit)](https://www.npmjs.com/package/@spatius/avatarkit)
[![@spatius/avatarkit-rtc](https://img.shields.io/npm/v/%40spatius%2Favatarkit-rtc?label=%40spatius%2Favatarkit-rtc)](https://www.npmjs.com/package/@spatius/avatarkit-rtc)

## What this demo is

The avatar **joins the call itself**. A LiveKit agent runs on your machine, Spatius joins
the same room as a participant, and the client renders what arrives over the room: audio
on an RTC track, motion encoded into the video stream. Nothing streams through the demo
server — it only issues room credentials and dispatches the agent.

```
Direct    client ──audio──►  Motion Server                    (client drives)
Backend   client ──mic───►  server ──►  Motion Server         (server drives)
LiveKit   client ◄────  LiveKit room  ────►  agent + avatar   (neither does)
```

**Choose this demo when:**
- You want the conversation to run on your own machine, with models routed by LiveKit
  Inference — no account with each model provider
- You are building on LiveKit Agents already

**Choose the [Agora demo](../agora-demo/) when:**
- You want Agora's Conversational AI Engine to host the conversation, with models and
  voice configured in its console
- You need the iOS or Android client — the mobile RTC SDKs ship the Agora stack alone

## Layout

```
livekit-demo/
├── servers/python/      Flask server + the LiveKit agent worker it starts
└── clients/web/         vue · react · vanilla · nextjs-direct · nextjs-iframe
```

## Quick Start

The server holds the credentials and starts the agent worker, so it goes first:

```bash
cd servers/python
cp .env.example .env    # Spatius App ID + API Key, LiveKit URL + key + secret
uv sync
uv run python server.py
```

Then a client, in a second terminal:

```bash
cd clients/web/vue      # or react, vanilla, nextjs-direct, nextjs-iframe
pnpm install
pnpm dev
```

Anything left blank in `.env` can be filled in on the client's configuration page.
Pick a conversation language and a voice there, press **Enter the room**, choose a
character, and talk.

The server's [README](./servers/python/README.md) covers the credentials, the API, and
the ways a session can fail without an error.

## Ports

The two RTC demos share their ports, so run one of them at a time:

| | Port |
|---|---|
| server | 8790 (`RTC_SERVER_PORT`), agent worker health check 8081 |
| react / vue / vanilla | 5190 / 5191 / 5192 |
| nextjs-direct / nextjs-iframe | 3020 / 3021 (iframe content on 5198) |
