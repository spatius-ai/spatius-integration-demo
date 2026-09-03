# Direct Mode server (Python)

Direct Mode means the **client** owns the Motion Server connection: it sends audio and
renders the motion that comes back. This server never touches motion data. It does two
things:

- mints short-lived **Session Tokens**, so `SPATIUS_API_KEY` stays on the server and
  the client holds no credentials at all;
- runs the realtime scene's **voice agent**, handing its synthesized speech back to the
  client as PCM.

## The two scenes

They differ only in where the client's audio comes from — both end at the same
`controller.send()` call, which is why the client code for them is nearly identical.

| | Sample audio | Realtime |
|---|---|---|
| Where the audio comes from | a bundled `.pcm` file | the browser microphone |
| What this server does | mints a Session Token, serves the clip | mints a token, and runs ASR → LLM → TTS |
| Credentials needed | Spatius only | Spatius **and** LiveKit |

```
sample audio    bundled .pcm  ─────────────────────────────►  controller.send()
realtime        mic ──ws──►  agent (ASR/LLM/TTS)  ──ws──►     controller.send()
```

### No LiveKit room

The realtime scene runs a LiveKit agent but **no LiveKit room**. `AgentSession` only
builds a RoomIO when its audio input and output are unset; this server sets both up
front (see `realtime.py`), so the microphone arrives over the client's own WebSocket
and the reply leaves the same way.

That is what keeps the client simple: it needs no LiveKit SDK, and both scenes reduce
to "get PCM, call `controller.send()`".

## Setup

```bash
cp .env.example .env      # fill in your credentials
uv sync
uv run app.py
```

Two listeners come up:

- `http://0.0.0.0:8090` — config, session tokens, the sample clip
- `ws://0.0.0.0:8091/ws/realtime` — the realtime scene

The LAN address is printed at startup and returned by `/health`. A phone cannot reach
your computer's `localhost`, so use that one from a device.

### Credentials

| Setting | Where to get it | Needed by |
|---|---|---|
| `SPATIUS_API_KEY` / `SPATIUS_APP_ID` | https://app.spatius.ai/apps | both scenes |
| `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | https://cloud.livekit.io | realtime only |

Models go through LiveKit Inference, so you do **not** need an OpenAI, Deepgram or
Cartesia account of your own. Change `STT_MODEL`, `LLM_MODEL` and `TTS_MODEL` in `.env`
to pick different ones.

The LiveKit API secret is shown only once, at creation — copy it there and then.

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
GET  /api/config          → appId, avatarId, region, and which keys are still missing
POST /api/session-token   → { sessionToken, expiredAt, appId, avatarId, region }
GET  /api/sample-audio    → the bundled PCM16 clip
GET  /health              → { ok, lanUrl, realtimeUrl }
```

`/api/config` reports `missing` per scene, so a client can grey out the scene it cannot
run yet and name the key rather than failing at the click.

### Realtime WebSocket

`ws://<host>:8091/ws/realtime`, PCM16 mono 16 kHz in both directions, base64 in JSON.

```jsonc
// client → server
{ "type": "start", "language": "en" }
{ "type": "mic_audio", "audio": "<base64 pcm16>" }
{ "type": "text", "text": "..." }        // a typed line, spoken as-is
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
