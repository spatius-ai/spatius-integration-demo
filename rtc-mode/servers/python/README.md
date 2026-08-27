# RTC Mode server (Python)

RTC Mode is the one path where the **avatar joins the call itself**. Audio travels on
an RTC track and the motion Spatius generates rides along encoded in the video stream,
so nothing streams through this server — it only issues the credentials to join a room
and gets the agent into it.

```
Direct    client ──audio──►  Motion Server                    (client drives)
Backend   client ──mic───►  server ──►  Motion Server         (server drives)
RTC       client ◄────  RTC room  ────►  agent + avatar       (neither does)
```

## Two transports

Chosen by `TRANSPORT` in `.env`, behind an API that is identical either way.

| | `livekit` | `agora` |
|---|---|---|
| Where the conversation runs | this machine, in a worker this server starts | Agora's Conversational AI Engine |
| Where ASR / LLM / TTS are configured | `.env` (routed by LiveKit Inference) | the Agora console, on a published agent |
| Accounts you need | Spatius + LiveKit | Spatius + Agora |
| A worker process to run | yes, started for you | no |

The web clients speak both and their config page switches between them. The mobile
clients ask for `agora` on every request and get it regardless of what `TRANSPORT` is
set to.

That is not a preference — it is the only transport they have. `avatarkit-ios-rtc` and
its Android counterpart ship the Agora stack alone, with no LiveKit client linked in.
Served the LiveKit response they would receive a room URL nothing in the app can open,
and fail on a decode error that says nothing about the cause; stating the one capability
up front turns that into a working session instead. `create_session` honours a client
that asks and leaves `TRANSPORT` to decide for anyone who does not.

**This is also the only mode with a transport at all.** It is worth being explicit,
because "which RTC stack" is a question the other two modes never ask:

| Mode | RTC | What the client links |
|---|---|---|
| Direct | none — the client holds the Motion Server connection | AvatarKit |
| Backend | none — LiveKit is used as an ASR/LLM/TTS pipeline with **no room** | AvatarKit |
| RTC | the avatar joins a real channel | AvatarKit + LiveKit *or* Agora |

So Backend Mode's LiveKit credentials are not a transport choice and have no Agora
equivalent to switch to: that path never opens a room, and its clients — mobile ones
included — never link an RTC SDK.

## Setup

```bash
cp .env.example .env      # fill in your credentials
uv sync
uv run python server.py
```

It binds `0.0.0.0`, not `127.0.0.1`: a phone on the same network cannot reach the dev
machine's loopback address, so the mobile clients would find nothing there. The web
clients work either way, since the browser runs on this machine.

### If a restart leaves the avatar mute

On `TRANSPORT=livekit` this server starts the agent worker for you, and the worker
opens a health-check port of its own (**8081**) alongside registering with LiveKit.
Two ways that goes wrong after a restart, both of which present the same way — the
room connects, the avatar renders, and nothing is ever said:

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

Flask comes up fine, `/health` answers, `/api/config` works — so the server looks
healthy. Only the agent is missing.

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

None of this applies to `TRANSPORT=agora`: Agora hosts the conversation, so there is no
worker and no second port. The startup banner says which one is in effect.

### Credentials

| Setting | Where to get it | Needed by |
|---|---|---|
| `SPATIUS_APP_ID` / `SPATIUS_API_KEY` / `SPATIUS_AVATAR_ID` | https://app.spatius.ai/apps | both transports |
| `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | https://cloud.livekit.io | `TRANSPORT=livekit` |
| `AGORA_APP_ID` / `AGORA_APP_CERTIFICATE` / `AGORA_PIPELINE_ID` | https://console.agora.io | `TRANSPORT=agora` |

The LiveKit API secret is shown only once, at creation — copy it there and then. On
Agora, enable the **App Certificate** on the project's page; tokens cannot be signed
without it.

To get the **pipeline id**: create an agent under Conversational AI → Agents, set its
prompt, ASR, LLM and TTS, publish it, and copy its id. That is where models and voice
live on this path — none of them are sent from this server.

> ⚠️ The ASR credential ids in `agora.py` (`ASR_RESOURCE_ZH` / `ASR_RESOURCE_EN`)
> belong to the console this demo was built against. Running it against your own agent
> means replacing them. A mismatch is silent: speech comes back as empty text or as
> "Yeah." and "Hello?", and nothing reports an error.

Sample rate matters on the Agora path: `AGORA_AVATAR_SAMPLE_RATE` must equal the TTS
output rate configured in the console. Motion Server does not resample, and a mismatch
is silent — the avatar joins, publishes, and never makes a sound.

The **voice** is not selectable from this demo on either path: on Agora it belongs to
the agent in the console (the same TTS panel as the sample rate above), and on LiveKit
it comes from `TTS_MODEL` / `TTS_VOICE` in `.env`. Change it there rather than in the
clients. Note that the accent follows the voice rather than the language setting — some
default voices read Chinese with an English accent.

### The failures that report nothing

Three settings on the Agora path fail **silently** — no error at either end, just
behaviour that looks like something else:

| Setting | Where | What it looks like when wrong |
|---|---|---|
| `AGORA_AVATAR_SAMPLE_RATE` | this server's `.env` | the avatar joins, publishes, and never makes a sound. It must equal the TTS output rate on the agent in the console; Motion Server does not resample. |
| `ASR_RESOURCE_ZH` / `ASR_RESOURCE_EN` | `agora.py` | speech transcribes to nothing, or comes back as "Yeah." and "Hello?". A credential serves one language, and pointing at the wrong one is not an error. |
| `AGORA_PIPELINE_ID` pointing at an unpublished agent | `.env` | `/api/session` succeeds and nobody ever speaks. |

Two more that apply to either transport:

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
GET  /health                   → { ok, missing, transport, lanUrl }
GET  /api/config               → saved credentials, per-transport field lists, what is missing
POST /api/config               → save credentials; takes effect immediately
POST /api/session              → join credentials + the agent on its way
POST /api/session/stop         → end a session
```

That is the whole API. Nothing drives the avatar, on either transport: once a client
has joined, everything reaches it over the RTC channel — which is what makes this RTC
Mode rather than one of the other two.

`/api/session` accepts `{ language, avatarId, transport }`; `transport` is optional and
pins the path for clients that can only speak one. The response always carries a
`transport` field saying which was used, and the rest of it varies with that:

```jsonc
// livekit
{ "transport": "livekit", "sessionId": "...", "url": "wss://…", "token": "…",
  "roomName": "…", "spatiusAppId": "…", "avatarId": "…" }

// agora
{ "transport": "agora", "sessionId": "…", "appId": "…", "channelName": "…",
  "token": "…", "uid": 123456, "agentUid": 654321,
  "spatiusAppId": "…", "spatiusRegion": "…", "avatarId": "…" }
```

### Stopping a session

**Billing starts when `/api/session` returns**, so `/api/session/stop` must be called on
the way out — including as the page unloads, where the web clients send it as a
`sendBeacon`. Both transports have a backstop (LiveKit's `empty_timeout`, ConvoAI's
`idle_timeout`), but those wait a minute and the minute is billed.

## ⚠️ This is a demo

There is no authentication: anyone who can reach this address can start a conversation,
and that costs money. Add authentication and rate limiting before putting it on a public
network, or keep it on your LAN.

## References

- [RTC Mode guide](https://docs.spatius.ai/rtc-mode/overview)
- [Regions & endpoints](https://docs.spatius.ai/api-reference/regions)
