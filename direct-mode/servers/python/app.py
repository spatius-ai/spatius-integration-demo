"""Direct Mode backend.

Direct Mode means the client owns the Motion Server connection: it sends audio and
renders the motion that comes back. This server therefore never touches motion data.
It does two things:

  * mints short-lived Session Tokens, so `SPATIUS_API_KEY` stays on the server and
    the client holds no credentials at all;
  * runs the realtime scene's voice agent, handing its synthesized speech back to the
    client as PCM.

The two scenes differ only in where the client's audio comes from:

    sample audio    bundled .pcm  ──────────────────────────► controller.send()
    realtime        mic ──ws──► agent (ASR/LLM/TTS) ──ws──► controller.send()

Both end at the same call, which is why the client code for them is nearly identical.

⚠️ This is a demo with no authentication. Anyone who can reach this address can mint a
token and start a conversation, and both cost money. Add authentication and rate
limiting before putting it on a public network.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import socket
import threading
import time as _time
from datetime import datetime, timezone
from pathlib import Path

import httpx
from flask import Flask, jsonify, request
from flask_cors import CORS

import config
from realtime import RealtimeAgent

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

HTTP_PORT = int(config.env("TOKEN_SERVER_PORT", "8090") or "8090")
WS_PORT = int(config.env("REALTIME_WS_PORT", "8091") or "8091")


def _err(message: str, status: int = 500, **extra):
    return jsonify({"error": message, **extra}), status


def _env_error(missing: list[str]):
    """The one failure every reader hits first: nothing filled in yet.

    Answered with what is missing and where to get it, rather than a stack trace from
    whichever call happened to need it.
    """
    return (
        jsonify(
            {
                "error": "invalid_server_env",
                "message": "Fill these in .env before using this scene.",
                "missingEnvFile": config.ENV_FILE_MISSING,
                "missingKeys": missing,
                "docs": config.DOCS_LINKS,
            }
        ),
        500,
    )


# ---------------------------------------------------------------- Config
#
# There is one copy of the configuration, in .env, and the clients do not keep their
# own. Filling the page in once writes back here, so the next visit — from this
# browser, another one, or a phone — starts with the values already in place.
#
# That matters most on a phone, where there is no .env to edit and pasting an API key
# into a virtual keyboard is not something to repeat.

ENV_PATH = Path(__file__).resolve().parent / ".env"

# What a client may read and write. Secrets are included: this server runs on the
# user's own machine, reachable on their LAN, and being able to fill everything in on
# screen matters more than keeping them out of an API that has no auth anyway.
#
# Only what has no working default. Model names, voices and endpoints already default
# in code; listing them here would suggest each has to be filled in.
EDITABLE_KEYS = [
    "SPATIUS_APP_ID",
    "SPATIUS_API_KEY",
    "SPATIUS_AVATAR_ID",
    "SPATIUS_REGION",
    "LIVEKIT_URL",
    "LIVEKIT_API_KEY",
    "LIVEKIT_API_SECRET",
]


def _read_env_file() -> dict[str, str]:
    """The keys already in .env. Understands only `KEY=value`, one per line."""
    if not ENV_PATH.exists():
        return {}
    existing: dict[str, str] = {}
    for raw in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        existing[key.strip()] = value.strip()
    return existing


@app.get("/api/config")
def read_config():
    """What the client needs to initialize the SDK, plus whatever is already saved.

    Direct Mode clients keep no `.env` of their own — that is the point of the token
    server — so the avatar, the region and any saved credentials reach them here.
    """
    saved = {key: config.env(key) for key in EDITABLE_KEYS}
    # A placeholder from .env.example is not a value; sent as-is it would populate the
    # form with `your_spatius_api_key` and look filled in.
    saved = {k: ("" if config.is_placeholder(v) else v) for k, v in saved.items()}

    return jsonify(
        {
            **saved,
            "avatarId": config.avatar_id(),
            "region": config.spatius_region(),
            "sampleRate": config.SAMPLE_RATE,
            "realtimeUrl": _realtime_url(),
            # Per scene, so the UI can grey out the one that cannot run yet and say
            # which key is missing, rather than failing at the click.
            #
            # The Spatius pair is absent from both: a client may paste its own, so a
            # server without them in .env is not necessarily unconfigured.
            "missing": {
                "sample": [],
                "realtime": config.missing_keys(
                    "LIVEKIT_URL",
                    "LIVEKIT_API_KEY",
                    "LIVEKIT_API_SECRET",
                ),
            },
        }
    )


@app.post("/api/config")
def write_config():
    """Save what was filled in on the page, taking effect immediately.

    Rewrites the whole file rather than appending: a repeated key resolves in a way
    that is not obvious, and duplicates eventually produce the "I changed it and
    nothing happened" problem. Comments and formatting are lost; what that buys is a
    file that always matches what is on screen.

    Keys already in the file that are not on the page — model names, voices, ports —
    are carried over, or the first save would wipe them out.
    """
    body = request.get_json(silent=True) or {}
    updates = {k: str(v).strip() for k, v in body.items() if k in EDITABLE_KEYS}
    # A blank field means "leave what is saved", not "erase it". Clearing a value is
    # done by editing the file, which is also the only place it is visible.
    updates = {k: v for k, v in updates.items() if v}

    merged = _read_env_file()
    merged.update(updates)

    lines = [
        "# Written by the demo's config page. You can also edit this file directly.",
        "",
    ]
    lines += [f"{key}={value}" for key, value in merged.items()]
    ENV_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")

    # Mirror into the running process, so a save takes effect without a restart.
    for key, value in updates.items():
        os.environ[key] = value

    logger.info("[config] saved %s", ", ".join(sorted(updates)) or "nothing")
    return jsonify({"ok": True, "saved": sorted(updates)})


# ---------------------------------------------------------------- Session tokens


def _extract_token(data: dict) -> str | None:
    direct_keys = ("sessionKey", "sessionToken", "token")
    for key in direct_keys:
        if data.get(key):
            return data[key]

    nested = data.get("data")
    if isinstance(nested, dict):
        for key in direct_keys:
            if nested.get(key):
                return nested[key]
    return None


@app.post("/api/session-token")
def issue_session_token():
    """Exchange an API Key for a short-lived Session Token.

    This is the whole reason Direct Mode needs a backend at all: an API Key is
    long-lived, while a Session Token expires within the hour and grants only what
    one session needs.

    The key comes from the request when the client sends one and from `.env`
    otherwise. A demo lets you paste it into the page to get going; a real
    deployment keeps it server-side and never accepts it from a browser.
    """
    body = request.get_json(silent=True) or {}

    api_key = str(body.get("apiKey") or "").strip() or config.env("SPATIUS_API_KEY")
    if not api_key or config.is_placeholder(api_key):
        return _env_error(["SPATIUS_API_KEY"])

    ttl_minutes = int(config.env("SESSION_TOKEN_TTL_MINUTES", "55") or "55")
    expire_at = int(_time.time()) + ttl_minutes * 60

    url = f"{config.console_endpoint()}/session-tokens"
    logger.info("[session-token] POST %s", url)

    try:
        with httpx.Client(timeout=20.0) as client:
            response = client.post(
                url,
                headers={"X-Api-Key": api_key, "Content-Type": "application/json"},
                # The console derives the app from the key, so no appId is sent.
                # modelVersion empty means the app's current default.
                json={"expireAt": expire_at, "modelVersion": ""},
            )
    except httpx.HTTPError as exc:
        return _err("session_token_request_failed", 502, detail=str(exc))

    if response.status_code >= 400:
        logger.error("[session-token] upstream %d: %s", response.status_code, response.text)
        return _err("session_token_request_failed", 502, detail=response.text)

    payload = response.json()
    if payload.get("errors"):
        logger.error("[session-token] upstream errors: %s", payload["errors"])
        return _err("session_token_request_failed", 502, detail=payload["errors"])

    token = _extract_token(payload)
    if not token:
        logger.error("[session-token] no token in payload: %s", payload)
        return _err("session_token_missing", 502, payload=payload)

    logger.info("[session-token] issued, expires in %d minutes", ttl_minutes)
    return jsonify(
        {
            "sessionToken": token,
            "expiredAt": datetime.fromtimestamp(expire_at, tz=timezone.utc).isoformat(),
            "avatarId": config.avatar_id(),
            "region": config.spatius_region(),
        }
    )


@app.get("/api/sample-audio")
def sample_audio():
    """The bundled clip for the sample-audio scene.

    Served from here rather than from the client's own `public/` so that all five
    framework clients play the same audio, and swapping it is one file on the server.
    """
    path = config.sample_audio_path()
    if not path.is_file():
        return _err("sample_audio_missing", 404, path=str(path))
    return app.response_class(path.read_bytes(), mimetype="application/octet-stream")


@app.get("/health")
def health():
    return jsonify(
        {
            "ok": True,
            "lanUrl": f"http://{_lan_ip()}:{HTTP_PORT}",
            "realtimeUrl": _realtime_url(),
        }
    )


def _realtime_url() -> str:
    """Where the client should reach the agent's WebSocket.

    Built from the host the request came in on rather than from an address picked
    here: on a machine with virtual interfaces (Docker, a VPN) the "LAN IP" this
    server would guess is often one nothing can route to, and the browser then
    fails the WebSocket handshake with nothing in the server log to explain it —
    the connection never arrives.

    A client that reached the page over the LAN reached this endpoint the same way,
    so its own host is the one address known to work.
    """
    host = request.host.split(":")[0] or _lan_ip()
    return f"ws://{host}:{WS_PORT}/ws/realtime"


def _lan_ip() -> str:
    """This machine's address on the LAN, for reaching the demo from a phone.

    The usual trick — open a UDP socket towards a public address and read back the
    local one — finds whichever interface holds the default route. With a VPN running
    that is the tunnel, and it answers with something like 172.19.0.1: a real address,
    on a network the phone is not on. So private ranges are collected from every
    interface first, and the probe is only the fallback.
    """
    candidates: list[str] = []
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            candidates.append(info[4][0])
    except OSError:
        pass

    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(("8.8.8.8", 80))
            candidates.append(probe.getsockname()[0])
    except OSError:
        pass

    # Home and office networks in the order they are actually met. 192.168/16 first
    # because a VPN or container bridge is far more likely to be sitting on 172.16/12
    # than a router is.
    for prefix in ("192.168.", "10.", "172."):
        for address in candidates:
            if address.startswith(prefix):
                return address
    return next((a for a in candidates if not a.startswith("127.")), "127.0.0.1")


# ---------------------------------------------------------------- Realtime scene
#
# On its own WebSocket server rather than Flask: the agent is asyncio throughout, and
# Flask's synchronous worker model has nowhere to run it.


async def _handle_realtime(websocket) -> None:
    """One browser, one conversation.

    The protocol is small enough to state in full:

        client → server   {type: "start", language?}
                          {type: "mic_audio", audio: <base64 pcm16>}
                          {type: "text", text}      a typed line, spoken as-is
                          {type: "interrupt"}
        server → client   {type: "ready"}
                          {type: "audio", audio: <base64 pcm16>}
                          {type: "turn_end"}        that reply is complete
                          {type: "interrupt"}       drop unplayed audio
                          {type: "transcript", role, text}
                          {type: "error", message}
    """
    loop = asyncio.get_running_loop()
    agent: RealtimeAgent | None = None

    def send(payload: dict) -> None:
        # Called from the agent's own callbacks, which may run on another task; the
        # threadsafe hop keeps sends ordered on this connection's loop.
        asyncio.run_coroutine_threadsafe(websocket.send(json.dumps(payload)), loop)

    try:
        async for raw in websocket:
            try:
                msg = json.loads(raw)
            except (TypeError, ValueError):
                continue

            kind = msg.get("type")

            if kind == "start":
                if agent is not None:
                    continue
                missing = config.missing_keys(
                    "LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"
                )
                if missing:
                    send({"type": "error", "message": f"missing config: {', '.join(missing)}"})
                    continue

                agent = RealtimeAgent(
                    on_audio=lambda pcm: send(
                        {"type": "audio", "audio": base64.b64encode(pcm).decode("ascii")}
                    ),
                    on_turn_end=lambda: send({"type": "turn_end"}),
                    on_interrupt=lambda: send({"type": "interrupt"}),
                    on_transcript=lambda role, text: send(
                        {"type": "transcript", "role": role, "text": text}
                    ),
                    language=(msg.get("language") or "en").strip(),
                )
                try:
                    await agent.start()
                except Exception as exc:  # noqa: BLE001 — reaches the user as a toast
                    logger.exception("agent start failed")
                    send({"type": "error", "message": str(exc)})
                    agent = None
                    continue
                send({"type": "ready"})

            elif kind == "mic_audio":
                if agent is None:
                    continue
                audio = msg.get("audio") or ""
                if audio:
                    agent.push_audio(base64.b64decode(audio))

            elif kind == "text":
                if agent is None:
                    continue
                text = (msg.get("text") or "").strip()
                if text:
                    await agent.say(text)

            elif kind == "interrupt":
                if agent is not None:
                    agent.interrupt()

    except Exception as exc:  # noqa: BLE001 — a dropped browser must not kill the server
        logger.info("realtime connection ended: %s", exc)
    finally:
        if agent is not None:
            await agent.aclose()


def _start_realtime_server() -> None:
    """Run the WebSocket server on its own thread, alongside Flask."""
    import websockets

    async def serve() -> None:
        async with websockets.serve(_handle_realtime, "0.0.0.0", WS_PORT, max_size=None):
            logger.info("realtime agent listening on ws://0.0.0.0:%d/ws/realtime", WS_PORT)
            await asyncio.Future()

    threading.Thread(target=lambda: asyncio.run(serve()), daemon=True).start()


if __name__ == "__main__":
    lan = _lan_ip()
    print(f"\n  Direct Mode server")
    print(f"  HTTP      http://0.0.0.0:{HTTP_PORT}   (LAN: http://{lan}:{HTTP_PORT})")
    print(f"  Realtime  ws://0.0.0.0:{WS_PORT}/ws/realtime\n")

    _start_realtime_server()
    # debug=False: the reloader runs this module twice, which would start a second
    # WebSocket server on a port already taken.
    app.run(host="0.0.0.0", port=HTTP_PORT, debug=False)
