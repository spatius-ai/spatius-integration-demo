"""Agora demo server.

The avatar joins the call itself. Audio travels on an RTC track and the motion Spatius
generates rides along encoded in the video stream, so **nothing streams through this
server** — it only signs the credentials to join a channel and asks Agora to start the
agent in it.

That is the whole difference from the other two modes:

    Direct    client ──audio──► Motion Server        (client holds the connection)
    Backend   client ──mic───► server ──► Motion Server ──► client   (server does)
    Agora     client ◄────  Agora channel  ────► agent + avatar      (neither does)

The conversation is hosted by Agora's Conversational AI Engine: ASR / LLM / TTS and
the voice are configured on a published agent in its console, and there is no worker
to run here. For the same demo with the conversation running on your own machine see
`../../../livekit-demo`.

`.env` is the demo's only configuration — credentials, the conversation language, the
default avatar. Nothing is entered on a client and nothing is written back here, so
this validates it on startup and refuses to run while a key is missing.

⚠️ This is a demo with no authentication. Anyone who can reach this address can start
a session, and sessions are billed. Add authentication and rate limiting before
putting it on a public network.
"""

from __future__ import annotations

import logging
import os
import socket
import sys
import threading
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_cors import CORS

import agora
from agora import DEFAULT_AVATAR_ID

ENV_PATH = Path(__file__).resolve().parent / ".env"
load_dotenv(ENV_PATH)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)


def _env(key: str, default: str = "") -> str:
    return (os.getenv(key, default) or "").strip()


# RTC_SERVER_PORT, not SERVER_PORT: Backend Mode reads that name too, and an
# exported SERVER_PORT in the shell would silently move both servers onto one port
# — with each .env overruled, since the environment wins. The old name still works
# so existing setups keep running.
HTTP_PORT = int(
    os.getenv("RTC_SERVER_PORT") or os.getenv("SERVER_PORT") or "8790"
)

# Everything this demo needs before it can serve a session. All of it lives in
# .env — nothing is entered on a client, and nothing is written back from here.
REQUIRED_KEYS = [
    "SPATIUS_APP_ID",
    "SPATIUS_API_KEY",
    "AGORA_APP_ID",
    "AGORA_APP_CERTIFICATE",
    "AGORA_PIPELINE_ID",
]

PLACEHOLDER_VALUES = {"your_spatius_api_key", "your_spatius_app_id", "replace_me"}

# Which language the conversation runs in. It fixes speech recognition and the persona
# at the moment the agent is started, so it cannot be switched on a running session —
# which is why it is a server setting rather than something a client sends.
CONVERSATION_LANGUAGE = (
    "zh" if _env("CONVERSATION_LANGUAGE", "en").lower().startswith("zh") else "en"
)


def _is_placeholder(value: str) -> bool:
    return value.strip().lower() in PLACEHOLDER_VALUES


def _validate_env_or_exit() -> None:
    """Fail at startup rather than at the first session, so a missing key is one
    message on the terminal that knows rather than a failed /api/session at a client."""
    missing = [k for k in REQUIRED_KEYS if not _env(k) or _is_placeholder(_env(k))]
    if not missing:
        return
    print("\n  Cannot start: these are missing from servers/python/.env\n", file=sys.stderr)
    for key in missing:
        print(f"    {key}", file=sys.stderr)
    print(
        "\n  Copy .env.example to .env and fill them in — every setting this demo has\n"
        "  lives there, including the conversation language.\n",
        file=sys.stderr,
    )
    raise SystemExit(1)


# ---------------------------------------------------------------- Config


@app.get("/api/config")
def read_config():
    """What a client needs to boot, and nothing else.

    No credential is echoed back: the API key, the Agora certificate and the pipeline
    id never leave this machine. The clients only need to know which avatar to load
    by default and which language the conversation will run in.
    """
    return jsonify(
        {
            "avatarId": _env("SPATIUS_AVATAR_ID") or DEFAULT_AVATAR_ID,
            "language": CONVERSATION_LANGUAGE,
        }
    )


# ---------------------------------------------------------------- Sessions

# Open sessions, by ConvoAI agent id. The agent id doubles as the sessionId: later
# actions look the agent up by it, so there is no second mapping to keep.
_sessions: set[str] = set()
_sessions_lock = threading.Lock()


@app.post("/api/session")
def create_session():
    """Everything the client needs to join: a channel, a token, and the agent on its way.

    Accepts `{ avatarId }` — the character the user picked, and the only genuinely
    per-session thing a client knows. The language, the credentials and everything else
    come from this server's .env, which was validated at startup.

    ⚠️ Billing starts here — the client must call /api/session/stop when it leaves.
    """
    body = request.get_json(silent=True) or {}
    avatar_id = str(body.get("avatarId") or "").strip()
    language = CONVERSATION_LANGUAGE

    try:
        session = agora.start_agent(avatar_id, language)
    except Exception as exc:  # noqa: BLE001 — everything becomes a JSON error
        logger.error("[session] create failed: %s", exc)
        return jsonify({"error": str(exc)}), 500

    with _sessions_lock:
        _sessions.add(session.agent_id)

    logger.info("[session] created %s (%s)", session.channel_name, language)
    return jsonify(
        {
            "sessionId": session.agent_id,
            "appId": session.app_id,
            "channelName": session.channel_name,
            "token": session.token,
            "uid": session.uid,
            # ConvoAI starts the agent asynchronously after /join returns, so the client
            # watches for this uid to appear before letting anyone speak.
            "agentUid": session.agent_uid,
            "spatiusAppId": session.spatius_app_id,
            "spatiusRegion": session.spatius_region,
            "avatarId": session.avatar_id,
        }
    )


@app.post("/api/session/stop")
def stop_session():
    """End a session. Called on the way out, including as the page unloads.

    Not left to ConvoAI's idle timeout: that waits a minute, and the minute is billed.
    """
    # force=True because this also arrives as a sendBeacon on page unload, which
    # sends text/plain: JSON would trigger a preflight, and unload has no time to
    # complete one. Without this the body is ignored and the agent bills on.
    body = request.get_json(silent=True, force=True) or {}
    session_id = str(body.get("sessionId") or "").strip()
    if not session_id:
        return jsonify({"error": "sessionId is required"}), 400

    with _sessions_lock:
        _sessions.discard(session_id)
    # An unknown id predates a restart. It is still the agent id, so it can still be
    # stopped; one that has already exited is not a failure.
    try:
        agora.stop_agent(session_id)
    except Exception as exc:  # noqa: BLE001
        logger.info("[session] stop %s: %s", session_id, exc)
    return jsonify({"ok": True})


@app.get("/health")
def health():
    """Alive, and where a phone can reach this machine.

    Nothing polls this — the mobile READMEs point at `lanUrl` for the address to put
    in `Config.swift` / `local.properties`.
    """
    return jsonify({"ok": True, "lanUrl": f"http://{_lan_ip()}:{HTTP_PORT}"})


# ---------------------------------------------------------------- Plumbing


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


if __name__ == "__main__":
    _validate_env_or_exit()

    lan = _lan_ip()
    print("\n  Agora demo server")
    print(f"  HTTP  http://0.0.0.0:{HTTP_PORT}   (LAN: http://{lan}:{HTTP_PORT})")
    print(f"  Conversation language: {CONVERSATION_LANGUAGE}\n")

    # It binds 0.0.0.0, not 127.0.0.1: a phone on the same network cannot reach this
    # machine's loopback address, and the mobile clients need to.
    app.run(host="0.0.0.0", port=HTTP_PORT, debug=False)
