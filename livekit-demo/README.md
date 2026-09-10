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

**All configuration lives in the server's `.env`** — credentials, conversation
language, voice and model. The clients enter nothing: they open straight on the
playground and send only the character you pick there.

The server holds the credentials and starts the agent worker, so it goes first:

```bash
cd servers/python
cp .env.example .env    # Spatius App ID + API Key, LiveKit URL + key + secret
uv sync
uv run python server.py
```

It refuses to start on an unfinished `.env`, printing each key still missing and
where to get it — so a key you forgot shows up here rather than as a session that
fails one click later.

Then a client, in a second terminal:

```bash
cd clients/web/vue      # or react, vanilla, nextjs-direct, nextjs-iframe
pnpm install
pnpm dev
```

It opens on the playground: choose a character and talk. Each client also takes a
`VITE_DEMO_SERVER_URL` / `NEXT_PUBLIC_DEMO_SERVER_URL` for when the server is not on
this machine — see each client's `.env.example` (for nextjs-iframe that is
`iframe-content/`, where the SDK actually runs); unset, it uses the page's own host
on port 8790.

To switch language or voice, edit `CONVERSATION_LANGUAGE` / `TTS_MODEL` in the
server's `.env` and restart it.

The server's [README](./servers/python/README.md) covers the credentials, the API, and
the ways a session can fail without an error.

## Ports

The two RTC demos share their ports, so run one of them at a time:

| | Port |
|---|---|
| server | 8790 (`RTC_SERVER_PORT`), agent worker health check 8081 |
| react / vue / vanilla | 5190 / 5191 / 5192 |
| nextjs-direct / nextjs-iframe | 3020 / 3021 (iframe content on 5198) |
