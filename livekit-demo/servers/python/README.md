# LiveKit demo server (Python)

This is the path where the **avatar joins the call itself**. Audio travels on an RTC
track and the motion Spatius generates rides along encoded in the video stream, so
nothing streams through this server — it only issues the credentials to join a room
and gets the agent into it.

```
Direct    client ──audio──►  Motion Server                    (client drives)
Backend   client ──mic───►  server ──►  Motion Server         (server drives)
LiveKit   client ◄────  LiveKit room  ────►  agent + avatar   (neither does)
```

The conversation runs on this machine, in a worker this server starts for you
(`agent.py`). ASR / LLM / TTS are routed by LiveKit Inference, so the only accounts you
need are Spatius and LiveKit. For the same demo with the conversation hosted by Agora's
Conversational AI Engine — no worker, models configured in a console — see
[`../../../agora-demo`](../../../agora-demo).

**This is the only path with an RTC transport at all.** It is worth being explicit,
because "which RTC stack" is a question the other two modes never ask:

| Mode | RTC | What the client links |
|---|---|---|
| Direct | none — the client holds the Motion Server connection | AvatarKit |
| Backend | none — LiveKit is used as an ASR/LLM/TTS pipeline with **no room** | AvatarKit |
| LiveKit demo | the avatar joins a real room | AvatarKit + LiveKit |

So Backend Mode's LiveKit credentials are not the same thing as these: that path never
opens a room, and its clients never link an RTC SDK.

## Setup

```bash
cp .env.example .env      # fill in your credentials
uv sync
uv run python server.py
```

**`.env` is the whole configuration** — credentials, conversation language, voice and
model. The clients enter nothing: they open on the playground and send only the
character the user picks.

The server validates `.env` before it binds anything. A key still unset, or left on
its placeholder, prints as:

```
  Cannot start: .env is incomplete.

    SPATIUS_APP_ID         https://app.spatius.ai/apps
    LIVEKIT_API_SECRET     https://cloud.livekit.io — shown only once, at creation
```

and the process exits non-zero. Checked at startup rather than at the first request,
because a demo that boots and then fails one click later — with the reason on a
browser console — is the slowest possible way to learn a key was never filled in.

It binds `0.0.0.0`, not `127.0.0.1`, so a phone on the same network can reach it. The
web clients work either way, since the browser runs on this machine.

The Agora demo's server listens on the same port (8790), so run one of the two at a
time, or move one with `RTC_SERVER_PORT`.

### If a restart leaves the avatar mute

This server starts the agent worker for you, and the worker opens a health-check port
of its own (**8081**) alongside registering with LiveKit. Two ways that goes wrong after
a restart, both of which present the same way — the room connects, the avatar renders,
and nothing is ever said:

```
Address already in use
Port 8790 is in use by another program.
```

The server exited because the previous one is still up. But it had **already forked a
worker** before failing, and that worker is now orphaned — holding 8081 with no server
attached. The next start then logs, buried among the worker's JSON lines:

```
OSError: [Errno 48] error while attempting to bind on address ('0.0.0.0', 8081)
"message": "worker failed"
```

Flask comes up fine and `/health` answers, so the server looks healthy. Only the
agent is missing.

Check both ports, not just the server's:

```bash
lsof -ti:8790   # this server
lsof -ti:8081   # the agent worker's health check
```

Stop the server properly (Ctrl-C, or `kill` its pid) and confirm **both** are free
before starting again; `kill -9 $(lsof -ti:8081)` clears a stranded worker. Stopping
the server the normal way takes its worker down with it — `_stop_worker` signals the
whole process group precisely so the forked children go too. It is the crash-on-startup
path that strands one.

A start that worked looks like this in the log, and it is worth checking for once:

```
registered worker  ...  "agent_name": "spatius-rtc-demo"
```

### Credentials

| Setting | Where to get it |
|---|---|
| `SPATIUS_APP_ID` / `SPATIUS_API_KEY` / `SPATIUS_AVATAR_ID` | https://app.spatius.ai/apps |
| `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | https://cloud.livekit.io |

The LiveKit API secret is shown only once, at creation — copy it there and then.

The **voice** is `TTS_MODEL` / `TTS_VOICE` in `.env`; `.env.example` lists the
synthesis models this demo has been run against. Note that the accent follows the
voice rather than `CONVERSATION_LANGUAGE` — some default voices read Chinese with an
English accent.

The **conversation language** is `CONVERSATION_LANGUAGE` (`en` | `zh`). It sets
recognition, synthesis and the assistant's persona, all of which are fixed when the
agent session is built — which is why it is set here rather than switched inside a
room. Changing it takes effect on the next session; changing `TTS_MODEL` needs the
server restarted, since the worker reads `.env` per job but is started by this
process.

### The failures that report nothing

- **A VPN moves what `lanUrl` reports.** The address is picked by looking at this
  machine's interfaces, and a tunnel's is a real address on a network the phone is not
  on. `/health` still answers 200 from the dev machine, so nothing looks wrong until a
  phone cannot reach it. Check the printed address against what the phone can actually
  open.
- **A stale process keeps the port.** A server that has stopped serving still holds
  its socket, so `lsof -ti:8790` says it is alive and every request hangs. If the log
  has no new lines for requests you know you made, that is what happened — kill it and
  start again.

## API

```
GET  /health                   → { ok, lanUrl }
GET  /api/config               → { appId } — what a client needs to boot
POST /api/session              → join credentials + the agent on its way
POST /api/session/stop         → end a session
```

That is the whole API. Nothing drives the avatar: once a client has joined, everything
reaches it over the room. There is no endpoint that writes `.env` — configuration is
the file, edited directly.

`/api/config` is read-only and returns nothing secret. The App ID is public — it
identifies the app to the SDK — so a client can initialize with it; the API key and
the LiveKit secret never leave this process.

`/api/session` accepts `{ avatarId }`, the one genuinely per-session choice, and
answers with what the client joins with:

```jsonc
{ "sessionId": "...", "url": "wss://…", "token": "…", "roomName": "…",
  "avatarId": "…" }
```

The avatar id and `CONVERSATION_LANGUAGE` ride to the worker as the room's metadata
(JSON): the worker is dispatched into existence and has no other way of knowing which
character to join as, or which language to listen and reply in. Sending the picked id
is what keeps the agent's avatar and the one the client renders the same.

### Stopping a session

**Billing starts when `/api/session` returns**, so `/api/session/stop` must be called on
the way out — including as the page unloads, where the web clients send it as a
`sendBeacon`. LiveKit's `empty_timeout` is the backstop, but it waits a minute and the
minute is billed.

## ⚠️ This is a demo

There is no authentication: anyone who can reach this address can start a conversation,
and that costs money. Add authentication and rate limiting before putting it on a public
network, or keep it on your LAN.

## References

- [LiveKit Agents integration](https://docs.spatius.ai/livekit-agents/overview)
- [Regions & endpoints](https://docs.spatius.ai/api-reference/regions)
