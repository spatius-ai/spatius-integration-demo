# Direct Mode server (Python)

Direct Mode means the **client** owns the Motion Server connection: it sends audio and
renders the motion that comes back. This server never touches motion data. It does two
things:

- mints short-lived **Session Tokens**, so `SPATIUS_API_KEY` stays on the server and
  the client holds no credentials at all;
- runs the **voice agent** — ASR, LLM and TTS — handing its synthesized speech back to
  the client as PCM.

```
mic ──ws──►  agent (ASR/LLM/TTS)  ──ws──►  controller.send()  ─►  Motion Server
```

Everything configurable lives in `.env`: credentials, region, avatar, conversation
language, models and voice. The clients send nothing but the avatar they want to
render — there is no configuration screen on any of them, and no endpoint here that
writes configuration.

### No LiveKit room

The agent runs on LiveKit but uses **no LiveKit room**. `AgentSession` only builds a
RoomIO when its audio input and output are unset; this server sets both up front (see
`realtime.py`), so the microphone arrives over the client's own WebSocket and the reply
leaves the same way.

That is what keeps the client simple: it needs no LiveKit SDK, and the whole path
reduces to "get PCM, call `controller.send()`".

## Setup

```bash
cp .env.example .env      # fill in your credentials
uv sync
uv run app.py
```

Two listeners come up:

- `http://0.0.0.0:8090` — config and session tokens
- `ws://0.0.0.0:8091/ws/realtime` — the conversation

The LAN address is printed at startup and returned by `/health`. A phone cannot reach
your computer's `localhost`, so use that one from a device.

### It refuses to start against an unfilled `.env`

`.env` is validated before anything binds a port. A missing or still-placeholder key
prints its name and where to get it, and the process exits non-zero:

```
  Cannot start: .env is incomplete.

    SPATIUS_API_KEY        https://app.spatius.ai/apps
    LIVEKIT_API_SECRET     https://cloud.livekit.io — shown only once, at creation
```

Every client boots by fetching `/api/config`, so a server that came up half-configured
would only move the failure somewhere with less context.

### Credentials

| Setting | Where to get it |
|---|---|
| `SPATIUS_API_KEY` / `SPATIUS_APP_ID` | https://app.spatius.ai/apps |
| `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | https://cloud.livekit.io |

All five are required. Models go through LiveKit Inference, so you do **not** need an
OpenAI, Deepgram or Cartesia account of your own. Change `STT_MODEL`, `LLM_MODEL` and
`TTS_MODEL` in `.env` to pick different ones.

The LiveKit API secret is shown only once, at creation — copy it there and then.

### Conversation settings

`CONVERSATION_LANGUAGE` (`en` | `zh`) picks the language the agent listens and replies
in. It is deliberately **not** a client setting: recognition, synthesis and the persona
are all fixed when the agent session is built, so changing it takes a restart rather
than a toggle. `TTS_VOICE` and `LLM_SYSTEM_PROMPT` are fixed here for the same reason.

Note the accent comes from the voice rather than from the language: some default voices
read Chinese with an accent, and only a few give you Mandarin.

### When it looks fine but the phone cannot reach it

Both of these leave the server answering normally from the dev machine, so nothing
looks wrong until a phone is involved:

- **A VPN moves what the startup banner reports.** The LAN address is picked from this
  machine's interfaces, and a tunnel's is a real address on a network the phone is not
  on — `172.19.0.1` rather than `192.168.x.x`. Check the printed address against what
  the phone can actually open, and use the phone's own network if they disagree.
- **A stale process keeps the port.** A server that has stopped serving still holds its
  socket, so `lsof -ti:8090` says it is alive while every request hangs. The tell is
  the log: if there are no new lines for requests you know you made, kill it and start
  again.

## API

```
GET  /api/config          → { appId, avatarId, region, sampleRate, realtimeUrl }
POST /api/session-token   → { sessionToken, expiredAt, avatarId, region }
GET  /health              → { ok, lanUrl, realtimeUrl }
```

`/api/config` is read-only and free of secrets: the App ID identifies the app rather
than authorizing anything, and the rest is addressing. `SPATIUS_API_KEY` and the
LiveKit credentials never leave this process.

`POST /api/session-token` takes no body — the console derives the app from the key.

### Realtime WebSocket

`ws://<host>:8091/ws/realtime`, PCM16 mono 16 kHz in both directions, base64 in JSON.

```jsonc
// client → server
{ "type": "start" }                       // no settings: they are all this server's
{ "type": "mic_audio", "audio": "<base64 pcm16>" }
{ "type": "text", "text": "..." }         // a typed line, spoken as-is
{ "type": "interrupt" }

// server → client
{ "type": "ready" }
{ "type": "audio", "audio": "<base64 pcm16>" }
{ "type": "turn_end" }                    // that reply is complete
{ "type": "interrupt" }                   // drop unplayed audio
{ "type": "transcript", "role": "user", "text": "..." }
{ "type": "error", "message": "..." }
```

Send `start` first and wait for `ready`; audio pushed before that is dropped.

## ⚠️ This is a demo

There is no authentication: anyone who can reach this address can mint a token and
start a conversation, and both cost money. Add authentication and rate limiting before
putting it on a public network, or keep it on your LAN.

## References

- [Direct Mode guide](https://docs.spatius.ai/direct-mode/client)
- [Session token guide](https://docs.spatius.ai/api-reference/auth)
- [Regions & endpoints](https://docs.spatius.ai/api-reference/regions)
