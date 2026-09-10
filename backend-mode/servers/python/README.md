# Backend Mode server (Python)

Backend Mode means the **server** owns the Motion Server connection: it drives the
avatar and sends clients encoded audio plus motion messages. Clients are thin — they
capture microphone audio and render what comes back, and hold no credentials at all.

## The conversation

```
mic ──ws──►  agent (ASR/LLM/TTS)  ─────►  avatar session ──► client
```

Audio is driven **as it arrives** rather than collected first: this backend holds the
avatar connection, so a reply starts moving the mouth while it is still being
synthesized.

### No LiveKit room

The conversation runs a LiveKit agent but **no LiveKit room**. `AgentSession` only
builds a RoomIO when its audio input and output are unset; this server sets both (see
`app/agent.py`), so the microphone arrives over the client's WebSocket and the reply
goes straight into the avatar session.

## Setup

```bash
cp .env.example .env      # fill in your credentials
uv sync
uv run python -m app.main
```

Every setting lives here: the credentials, and the conversation options the clients
used to ask for — language, region, voice. **The server validates `.env` at startup**
and, if a required key is missing or still a placeholder, prints the key names with a
one-line hint each and exits non-zero. Nothing to configure on the client side.

That binds `0.0.0.0`, not uvicorn's `127.0.0.1` default: a phone on the same network
cannot reach the dev machine's loopback address, so the mobile clients would find
nothing there. The Web clients work either way, since the browser runs on this machine.

`uv run uvicorn app.main:app --host 0.0.0.0 --port 8765` does the same thing. Starting
it any way that leaves the host at its default — an IDE run configuration, plain
`uvicorn app.main:app` — is the one to avoid: it comes up fine and only the phones
cannot see it.

### Credentials

| Setting | Where to get it | Needed by |
|---|---|---|
| `SPATIUS_APP_ID` / `SPATIUS_API_KEY` / `SPATIUS_AVATAR_ID` | https://app.spatius.ai/apps | the avatar |
| `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | https://cloud.livekit.io | the conversation |

Models are routed by LiveKit Inference, so you do **not** need an OpenAI, Deepgram or
Cartesia account of your own — LiveKit's three credentials replace all of them. Change
`STT_MODEL`, `LLM_MODEL` and `TTS_MODEL` in `.env` to pick different ones.

The LiveKit API secret is shown only once, at creation — copy it there and then.

### Conversation language

`CONVERSATION_LANGUAGE` (`en` | `zh`) sets speech recognition, synthesis and the
agent's persona at once. All three are fixed when the agent session is built, so it is
a server setting rather than something a client switches mid-conversation — no client
sends a language. Note the accent comes from `TTS_VOICE` rather than from the
language: some default voices read Chinese with an accent.

### When it looks fine but the phone cannot reach it

Both of these leave the server answering normally from the dev machine, so nothing
looks wrong until a phone is involved:

- **A VPN moves what the startup banner reports.** The LAN address is picked from this
  machine's interfaces, and a tunnel's is a real address on a network the phone is not
  on — `172.19.0.1` rather than `192.168.x.x`. Check the printed address against what
  the phone can actually open, and use the phone's own network if they disagree.
- **A stale process keeps the port.** A server that has stopped serving still holds its
  socket, so `lsof -ti:8765` says it is alive while every request hangs. The tell is
  the log: if there are no new lines for requests you know you made, kill it and start
  again.

## API

```
GET  /healthz     → { ok }
GET  /api/config  → appId, avatarId, region, inputSampleRate
WS   /ws/agent    → the session below
```

`/api/config` is read-only and free of credentials: it is what a client needs to call
`AvatarSDK.initialize` and open on a character, and the whole of it. There is no
endpoint that writes configuration — the server's `.env` is the only source, and a key
that is missing there stops the server rather than reaching a client.

### WebSocket protocol

PCM16 mono at the configured sample rates, base64 in JSON.

```jsonc
// client → server
{ "type": "set_avatar", "avatarId": "..." }
{ "type": "start_agent" }                      // language comes from the server's .env
{ "type": "mic_audio", "audio": "<base64 pcm16>" }
{ "type": "text", "text": "..." }              // speak a typed line
{ "type": "interrupt" }

// server → client
{ "type": "ready" }                            // the socket is up; config came from /api/config
{ "type": "agent_ready" }
{ "type": "avatar_audio", "audio": "<base64>", "isLast": false }
{ "type": "avatar_frames", "frames": ["<base64>"], "isLast": false }
{ "type": "transcript", "role": "user", "text": "..." }
{ "type": "interrupt", "reason": "..." }
{ "type": "error", "message": "..." }
```

Rendering a turn takes both message types: `avatar_audio` carries the sound (the
client plays it via `yieldAudioData`), `avatar_frames` carries the motion
(`yieldFramesData`, keyed by the conversation id `yieldAudioData` returned). Each
`frames` entry is a protobuf batch of many animation frames, not a single one.

Send `start_agent` before any `mic_audio` and wait for `agent_ready`; audio pushed
before that is dropped.

## ⚠️ This is a demo

There is no authentication: anyone who can reach this address can start a
conversation, and that costs money. Add authentication and rate limiting before
putting it on a public network, or keep it on your LAN.

## References

- [Backend Mode guide](https://docs.spatius.ai/backend-mode/server-sdk)
- [Regions & endpoints](https://docs.spatius.ai/api-reference/regions)
