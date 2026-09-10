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

⚠️ This is a demo with no authentication. Anyone who can reach this address can start
a session, and sessions are billed. Add authentication and rate limiting before
putting it on a public network.
"""

from __future__ import annotations

import logging
import os
import socket
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

# RTC_SERVER_PORT, not SERVER_PORT: Backend Mode reads that name too, and an
# exported SERVER_PORT in the shell would silently move both servers onto one port
# — with each .env overruled, since the environment wins. The old name still works
# so existing setups keep running.
HTTP_PORT = int(
    os.getenv("RTC_SERVER_PORT") or os.getenv("SERVER_PORT") or "8790"
)

# What a client may read and write, mirroring the other modes' config pages.
# Secrets are included: this server runs on the user's own machine, and being able to
# fill everything in on screen — from a phone, which has no .env to edit — matters
# more than keeping them out of an API that has no auth anyway.
COMMON_KEYS = ["SPATIUS_APP_ID", "SPATIUS_API_KEY", "SPATIUS_AVATAR_ID"]
AGORA_KEYS = ["AGORA_APP_ID", "AGORA_APP_CERTIFICATE", "AGORA_PIPELINE_ID"]
EDITABLE_KEYS = COMMON_KEYS + AGORA_KEYS

PLACEHOLDER_VALUES = {"your_spatius_api_key", "your_spatius_app_id", "replace_me"}


def _env(key: str, default: str = "") -> str:
    return (os.getenv(key, default) or "").strip()


def _is_placeholder(value: str) -> bool:
    return value.strip().lower() in PLACEHOLDER_VALUES


# Editable but not required: it has a working default, and reporting it as missing
# would block the client on a setting it never has to touch.
OPTIONAL_KEYS = {"SPATIUS_AVATAR_ID"}


def _missing() -> list[str]:
    """Everything this demo needs that is still unset."""
    return [
        k
        for k in EDITABLE_KEYS
        if k not in OPTIONAL_KEYS and (not _env(k) or _is_placeholder(_env(k)))
    ]


# ---------------------------------------------------------------- Config


def _read_env_file() -> dict[str, str]:
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
    """What the client needs, plus whatever credentials are already saved.

    `missing` names each key still unset, so the config page can point at it rather
    than failing at the click. The mobile clients read the same list.
    """
    saved = {
        key: ("" if _is_placeholder(_env(key)) else _env(key)) for key in EDITABLE_KEYS
    }
    return jsonify(
        {
            **saved,
            "avatarId": _env("SPATIUS_AVATAR_ID") or DEFAULT_AVATAR_ID,
            "missing": _missing(),
        }
    )


@app.post("/api/config")
def write_config():
    """Save what was filled in on the page, taking effect immediately.

    Rewrites the whole file rather than appending: a repeated key resolves in a way
    that is not obvious, and duplicates eventually produce the "I changed it and
    nothing happened" problem. Keys already in the file that are not on the page are
    carried over.
    """
    body = request.get_json(silent=True) or {}
    updates = {k: str(v).strip() for k, v in body.items() if k in EDITABLE_KEYS}
    # A blank field means "leave what is saved", not "erase it".
    updates = {k: v for k, v in updates.items() if v}

    merged = _read_env_file()
    merged.update(updates)
    lines = [
        "# Written by the demo's config page. You can also edit this file directly.",
        "",
    ]
    lines += [f"{k}={v}" for k, v in merged.items()]
    ENV_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")

    # agora.py reads the environment on every call, so a save takes effect on the
    # next session with nothing to restart.
    for key, value in updates.items():
        os.environ[key] = value

    logger.info("[config] saved %s", ", ".join(sorted(updates)) or "nothing")
    return jsonify({"ok": True, "saved": sorted(updates)})


# ---------------------------------------------------------------- Sessions

# Open sessions, by ConvoAI agent id. The agent id doubles as the sessionId: later
# actions look the agent up by it, so there is no second mapping to keep.
_sessions: set[str] = set()
_sessions_lock = threading.Lock()


@app.post("/api/session")
def create_session():
    """Everything the client needs to join: a channel, a token, and the agent on its way.

    Accepts `{ language, avatarId }`. The mobile clients also send `transport: "agora"`,
    a leftover from when one server served both transports; it is ignored here, since
    Agora is the only thing this server speaks.

    ⚠️ Billing starts here — the client must call /api/session/stop when it leaves.
    """
    body = request.get_json(silent=True) or {}
    language = "zh" if str(body.get("language") or "en").lower().startswith("zh") else "en"
    avatar_id = str(body.get("avatarId") or "").strip()

    missing = _missing()
    if missing:
        return jsonify({"error": "invalid_server_env", "missingKeys": missing}), 500

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
    return jsonify(
        {
            "ok": not _missing(),
            "missing": _missing(),
            "lanUrl": f"http://{_lan_ip()}:{HTTP_PORT}",
        }
    )


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
    lan = _lan_ip()
    print("\n  Agora demo server")
    print(f"  HTTP  http://0.0.0.0:{HTTP_PORT}   (LAN: http://{lan}:{HTTP_PORT})\n")

    # It binds 0.0.0.0, not 127.0.0.1: a phone on the same network cannot reach this
    # machine's loopback address, and the mobile clients need to.
    app.run(host="0.0.0.0", port=HTTP_PORT, debug=False)
