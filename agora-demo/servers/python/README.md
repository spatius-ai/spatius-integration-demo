# Agora demo server (Python)

This is the path where the **avatar joins the call itself**. Audio travels on an RTC
track and the motion Spatius generates rides along encoded in the video stream, so
nothing streams through this server — it only signs the credentials to join a channel
and asks Agora to start the agent in it.

```
Direct    client ──audio──►  Motion Server                    (client drives)
Backend   client ──mic───►  server ──►  Motion Server         (server drives)
Agora     client ◄────  Agora channel  ────►  agent + avatar  (neither does)
```

The conversation is hosted by Agora's Conversational AI Engine (ConvoAI): ASR / LLM /
TTS and the voice are configured on a published agent in its console, and there is no
worker to run here. The avatar goes in as a ConvoAI avatar vendor (`spatius`): the engine
feeds TTS audio to Spatius, Spatius generates motion and joins the same channel as its
own publisher, and the client's AvatarKit subscribes and renders locally. For the same
demo with the conversation running on your own machine see
[`../../../livekit-demo`](../../../livekit-demo).

Every client here — web, iOS and Android — speaks Agora. The mobile clients ship the
Agora stack alone (`avatarkit-ios-rtc` and its Android counterpart), which is why this
is the demo that has them.

## Setup

```bash
cp .env.example .env      # fill in your credentials
uv sync
uv run python server.py
```

It binds `0.0.0.0`, not `127.0.0.1`: a phone on the same network cannot reach the dev
machine's loopback address, so the mobile clients would find nothing there. The web
clients work either way, since the browser runs on this machine.

The LiveKit demo's server listens on the same port (8790), so run one of the two at a
time, or move one with `RTC_SERVER_PORT`.

### Credentials

| Setting | Where to get it |
|---|---|
| `SPATIUS_APP_ID` / `SPATIUS_API_KEY` / `SPATIUS_AVATAR_ID` | https://app.spatius.ai/apps |
| `AGORA_APP_ID` / `AGORA_APP_CERTIFICATE` / `AGORA_PIPELINE_ID` | https://console.agora.io |

Enable the **App Certificate** on the project's page; tokens cannot be signed without
it. It is a different value from the App ID, and the console masks it — if a session
fails with **HTTP 401**, the first thing to check is that the certificate field does
not hold the App ID again.

The REST calls are authenticated with a token signed from the App ID and certificate,
which is why you do not need the Customer ID / Secret pair. A project created in the
Shengwang (China) console uses a different REST endpoint: set `AGORA_CONVOAI_BASE_URL`.

To get the **pipeline id**: create an agent under Conversational AI → Agents, set its
prompt, LLM and TTS, publish it, and copy its id. That is where models and voice live
on this path — none of them are sent from this server.

If starting a session fails with **`properties: tts.addon not found`**, the pipeline id
does not resolve under this App ID: a made-up id, an id copied from an agent in a
different project, and an agent that was never published all fail with exactly that
message. Check that the agent lives in the project whose App ID you entered, that it has
been published, and that the id is the pipeline id (not the agent's name or URL). The
full upstream response is printed to this server's terminal.

Leave the agent's **ASR** at what a new agent comes with (Deepgram `nova-3`). This
server sends that exact vendor and model with every session, so a fresh agent works as
is. Only if you change the ASR vendor or model in the console do `ASR_VENDOR` /
`ASR_MODEL` at the top of `agora.py` need to follow — the `resource_id` shown next to
them in the console is not needed: the join API ignores it, and the credential comes
from the agent itself.

Sample rate matters: `AGORA_AVATAR_SAMPLE_RATE` must equal the TTS output rate
configured in the console. Motion Server does not resample, and a mismatch is silent —
the avatar joins, publishes, and never makes a sound.

The **voice** is not selectable from this demo: it belongs to the agent in the console
(the same TTS panel as the sample rate above). Change it there rather than in the
clients. Note that the accent follows the voice rather than the language setting — some
default voices read Chinese with an English accent.

`SPATIUS_REGION` says which Spatius endpoint the avatar is served from; it defaults to
`cn-beijing`, and accounts on the US endpoint need `us-west`.

### The failures that report nothing

Three settings fail **silently** — no error at either end, just behaviour that looks
like something else:

| Setting | Where | What it looks like when wrong |
|---|---|---|
| `AGORA_AVATAR_SAMPLE_RATE` | this server's `.env` | the avatar joins, publishes, and never makes a sound. It must equal the TTS output rate on the agent in the console; Motion Server does not resample. |
| `ASR_VENDOR` / `ASR_MODEL` not matching the agent | `agora.py` | speech transcribes to nothing, or comes back as "Yeah." and "Hello?". Only an issue if the ASR was changed from the console defaults. |
| `AGORA_PIPELINE_ID` pointing at an unpublished agent | `.env` | `/api/session` succeeds and nobody ever speaks. |

Two more:

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
GET  /health                   → { ok, missing, lanUrl }
GET  /api/config               → saved credentials, what is missing
POST /api/config               → save credentials; takes effect immediately
POST /api/session              → join credentials + the agent on its way
POST /api/session/stop         → end a session
```

That is the whole API. Nothing drives the avatar: once a client has joined, everything
reaches it over the channel.

`/api/session` accepts `{ language, avatarId }` and answers with what the client joins
with:

```jsonc
{ "sessionId": "…", "appId": "…", "channelName": "…",
  "token": "…", "uid": 123456, "agentUid": 654321,
  "spatiusAppId": "…", "spatiusRegion": "…", "avatarId": "…" }
```

`sessionId` is ConvoAI's agent id. `agentUid` is what the client watches for: ConvoAI
starts the agent asynchronously after `/join` returns, and audio sent before it is in
the channel is dropped.

### Stopping a session

**Billing starts when `/api/session` returns**, so `/api/session/stop` must be called on
the way out — including as the page unloads, where the web clients send it as a
`sendBeacon`. ConvoAI's `idle_timeout` is the backstop, but it waits a minute and the
minute is billed.

## ⚠️ This is a demo

There is no authentication: anyone who can reach this address can start a conversation,
and that costs money. Add authentication and rate limiting before putting it on a public
network, or keep it on your LAN.

## References

- [Agora ConvoAI integration](https://docs.spatius.ai/agora-convoai/overview)
- [Regions & endpoints](https://docs.spatius.ai/api-reference/regions)
