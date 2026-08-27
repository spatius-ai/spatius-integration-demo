"""RTC Mode server.

RTC Mode is the one path where the avatar joins the call itself. Audio travels on an
RTC track and the motion Spatius generates rides along encoded in the video stream,
so **nothing streams through this server** — it only issues the credentials to join
a room and gets the agent into it.

That is the whole difference from the other two modes:

    Direct    client ──audio──► Motion Server        (client holds the connection)
    Backend   client ──mic───► server ──► Motion Server ──► client   (server does)
    RTC       client ◄────  RTC room  ────► agent + avatar           (neither does)

## Two transports

Chosen by `TRANSPORT` in `.env`, behind an API that is identical either way:

    livekit  The conversation runs on this machine. This server starts the agent
             worker (agent.py) for you. Models go through LiveKit Inference, so you
             do not need an account with each provider.
    agora    Agora's Conversational AI Engine hosts ASR / LLM / TTS and the avatar.
             Models and voice are configured in its console instead of here, and
             there is no worker to run.

The web clients speak both. The mobile clients ship the Agora SDK alone and say so
on each request — see `/api/session`.

⚠️ This is a demo with no authentication. Anyone who can reach this address can start
a session, and sessions are billed. Add authentication and rate limiting before
putting it on a public network.
"""

from __future__ import annotations

import asyncio
import atexit
import logging
import os
import signal
import socket
import subprocess
import sys
import threading
import time as _time
import uuid
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_cors import CORS

from agent import AGENT_NAME, DEFAULT_AVATAR_ID

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

# What a client may read and write, mirroring the other two modes' config pages.
# Secrets are included: this server runs on the user's own machine, and being able to
# fill everything in on screen — from a phone, which has no .env to edit — matters
# more than keeping them out of an API that has no auth anyway.
COMMON_KEYS = ["SPATIUS_APP_ID", "SPATIUS_API_KEY", "SPATIUS_AVATAR_ID"]
# TTS_MODEL is a LiveKit key rather than a common one: on the Agora path the voice
# belongs to the agent published in its console and nothing sent from here can change
# it, so the page points at the console instead of offering a picker.
LIVEKIT_KEYS = ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "TTS_MODEL"]
AGORA_KEYS = ["AGORA_APP_ID", "AGORA_APP_CERTIFICATE", "AGORA_PIPELINE_ID"]
# The transport switch itself is editable too; without it there is no way to change
# transports from the UI.
EDITABLE_KEYS = ["TRANSPORT"] + COMMON_KEYS + LIVEKIT_KEYS + AGORA_KEYS

PLACEHOLDER_VALUES = {"your_spatius_api_key", "your_spatius_app_id", "replace_me"}


def _env(key: str, default: str = "") -> str:
    return (os.getenv(key, default) or "").strip()


def _is_placeholder(value: str) -> bool:
    return value.strip().lower() in PLACEHOLDER_VALUES


def _transport() -> str:
    """The transport currently in effect: livekit or agora, defaulting to livekit."""
    value = _env("TRANSPORT").lower()
    return value if value in ("livekit", "agora") else "livekit"


# Editable but not required: these have working defaults, and reporting them as missing
# would block the client on a setting it never has to touch.
OPTIONAL_KEYS = {"SPATIUS_AVATAR_ID", "TTS_MODEL"}


def _missing(transport: str = "") -> list[str]:
    """Everything RTC Mode needs on a given transport.

    Only that transport's keys are reported: with both listed, a fully configured Agora
    setup would still show three LiveKit keys as missing and the client would refuse to
    start on credentials it never needed.
    """
    transport = transport or _transport()
    keys = COMMON_KEYS + (AGORA_KEYS if transport == "agora" else LIVEKIT_KEYS)
    return [
        k
        for k in keys
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

    `fields` says which settings each transport uses, so the config page can show only
    the ones that apply and name a missing key rather than failing at the click.
    """
    saved = {
        key: ("" if _is_placeholder(_env(key)) else _env(key)) for key in EDITABLE_KEYS
    }
    return jsonify(
        {
            **saved,
            "TRANSPORT": _transport(),
            "avatarId": _env("SPATIUS_AVATAR_ID") or DEFAULT_AVATAR_ID,
            "fields": {"common": COMMON_KEYS, "livekit": LIVEKIT_KEYS, "agora": AGORA_KEYS},
            "missing": _missing(),
            # Per transport as well, so a client that pins one (the mobile ones pin
            # Agora) can check the list that actually applies to it.
            "missingByTransport": {
                "livekit": _missing("livekit"),
                "agora": _missing("agora"),
            },
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

    for key, value in updates.items():
        os.environ[key] = value

    # The worker is a separate process and read .env at its own startup, so the
    # values above never reach it. Restarting is what makes a save take effect
    # without the user having to restart the server themselves.
    _restart_worker()

    logger.info("[config] saved %s", ", ".join(sorted(updates)) or "nothing")
    return jsonify({"ok": True, "saved": sorted(updates)})


# ---------------------------------------------------------------- Sessions


def _livekit_env() -> tuple[str, str, str]:
    url, key, secret = _env("LIVEKIT_URL"), _env("LIVEKIT_API_KEY"), _env("LIVEKIT_API_SECRET")
    if not (url and key and secret):
        raise RuntimeError("LiveKit credentials are not configured")
    return url, key, secret


async def _list_rooms() -> list:
    """Every room this project currently has open."""
    from livekit import api

    url, key, secret = _livekit_env()
    lkapi = api.LiveKitAPI(url, key, secret)
    try:
        return list((await lkapi.room.list_rooms(api.ListRoomsRequest())).rooms)
    finally:
        await lkapi.aclose()


async def _delete_room(room_name: str) -> None:
    from livekit import api

    url, key, secret = _livekit_env()
    lkapi = api.LiveKitAPI(url, key, secret)
    try:
        await lkapi.room.delete_room(api.DeleteRoomRequest(room=room_name))
    finally:
        await lkapi.aclose()


async def _reap_orphans() -> None:
    """Close rooms this demo left behind.

    The client stops its own room on the way out, and LiveKit reaps one whose
    participants have all left. Neither covers a server that was killed while a
    room was open: the browser stays connected to LiveKit, so the room looks busy
    and bills on with nobody watching.

    Run at startup, and only against rooms this demo named — a shared LiveKit
    project may have others in it.
    """
    try:
        rooms = await _list_rooms()
    except Exception as exc:  # noqa: BLE001 — startup must not fail over this
        logger.warning("[reap] could not list rooms: %s", exc)
        return

    stale = [r.name for r in rooms if r.name.startswith("spatius-rtc-")]
    for name in stale:
        try:
            await _delete_room(name)
            logger.info("[reap] closed leftover room %s", name)
        except Exception as exc:  # noqa: BLE001
            logger.warning("[reap] could not close %s: %s", name, exc)


async def _create_room(room_name: str, language: str) -> None:
    """Create the room and dispatch the agent into it.

    Dispatching is required: the worker registers under an agent name, and only an
    explicit dispatch pulls it into a room.
    """
    from livekit import api

    url, key, secret = _livekit_env()
    lkapi = api.LiveKitAPI(url, key, secret)
    try:
        try:
            # Fallback cleanup: a client cannot always send a stop — a closed tab, a
            # lost network — and letting LiveKit reap the room on a timeout is more
            # reliable than running a timer here. Both are short: sessions bill by
            # duration, so an empty room is money burning.
            await lkapi.room.create_room(
                api.CreateRoomRequest(
                    name=room_name,
                    empty_timeout=120,
                    departure_timeout=20,
                    # The language rides to the worker on the room: it is dispatched
                    # into existence and has no other way of knowing which language
                    # to listen and reply in.
                    metadata=language,
                )
            )
        except Exception:
            # The room may already exist, which is not an error here.
            pass
        await lkapi.agent_dispatch.create_dispatch(
            api.CreateAgentDispatchRequest(room=room_name, agent_name=AGENT_NAME)
        )
    finally:
        await lkapi.aclose()


# Sessions: sessionId → (transport, that path's own handle).
#
# The handle differs per transport: a room name for LiveKit, ConvoAI's agent id for
# Agora. Recorded rather than re-derived so that sessions started before a transport
# switch can still be stopped — otherwise they bill on with nothing able to end them.
_sessions: dict[str, tuple[str, str]] = {}
_sessions_lock = threading.Lock()


@app.post("/api/session")
def create_session():
    """Everything the client needs to join: a room, a token, and the agent on its way.

    The `transport` field in the response tells the client which RTC stack to come in
    on — the rest of the response varies with it, and the client picks its provider
    accordingly.

    ⚠️ Billing starts here — the client must call /api/session/stop when it leaves.
    """
    body = request.get_json(silent=True) or {}
    language = "zh" if str(body.get("language") or "en").lower().startswith("zh") else "en"
    avatar_id = str(body.get("avatarId") or "").strip()

    transport = _transport()
    # A client that can only speak one transport says so, and gets it regardless of what
    # TRANSPORT is set to. The mobile clients ship the Agora SDK alone: served the
    # LiveKit response they would get a room name and a URL they cannot use, and fail on
    # a decode error that says nothing about the cause. TRANSPORT still decides for
    # anyone who does not ask — the web clients speak both and leave this out.
    wanted = str(body.get("transport") or "").strip().lower()
    if wanted in ("agora", "livekit"):
        transport = wanted

    missing = _missing(transport)
    if missing:
        return jsonify({"error": "invalid_server_env", "missingKeys": missing}), 500

    try:
        if transport == "agora":
            return _create_agora_session(avatar_id, language)
        return _create_livekit_session(avatar_id, language)
    except Exception as exc:  # noqa: BLE001 — everything becomes a JSON error
        logger.error("[session] create failed on %s: %s", transport, exc)
        return jsonify({"error": str(exc)}), 500


def _create_livekit_session(avatar_id: str, language: str):
    from livekit import api

    url, key, secret = _livekit_env()
    room_name = f"spatius-rtc-{uuid.uuid4().hex[:10]}"
    _run(_create_room(room_name, language))

    token = (
        api.AccessToken(key, secret)
        .with_identity(f"user-{uuid.uuid4().hex[:8]}")
        .with_grants(api.VideoGrants(room_join=True, room=room_name, can_publish=True))
        .to_jwt()
    )

    # A worker that died takes the avatar with it, and the symptom on the client is
    # only "waiting for the agent". Better said here, where the reason is knowable.
    if _worker is not None and _worker.poll() is not None:
        logger.error("[worker] is not running — the agent cannot join this room")

    with _sessions_lock:
        _sessions[room_name] = ("livekit", room_name)

    logger.info("[session] created %s (livekit, %s)", room_name, language)
    return jsonify(
        {
            "transport": "livekit",
            "sessionId": room_name,
            "roomName": room_name,
            "url": url,
            "token": token,
            "spatiusAppId": _env("SPATIUS_APP_ID"),
            "avatarId": avatar_id or _env("SPATIUS_AVATAR_ID") or DEFAULT_AVATAR_ID,
        }
    )


def _create_agora_session(avatar_id: str, language: str):
    import agora

    session = agora.start_agent(avatar_id, language)
    # The agent id doubles as the sessionId: later actions look the agent up by it, so
    # there is no second mapping to keep.
    with _sessions_lock:
        _sessions[session.agent_id] = ("agora", session.agent_id)

    logger.info("[session] created %s (agora, %s)", session.channel_name, language)
    return jsonify(
        {
            "transport": "agora",
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

    Not left to the room's own timeout: that waits a minute, and the minute is
    billed.
    """
    # force=True because this also arrives as a sendBeacon on page unload, which
    # sends text/plain: JSON would trigger a preflight, and unload has no time to
    # complete one. Without this the body is ignored and the room bills on.
    body = request.get_json(silent=True, force=True) or {}
    session_id = str(body.get("sessionId") or "").strip()
    if not session_id:
        return jsonify({"error": "sessionId is required"}), 400

    with _sessions_lock:
        entry = _sessions.pop(session_id, None)
    # An unknown id predates a restart. LiveKit ids are room names, so they can still be
    # closed; an Agora agent id cannot be guessed at, so it is left to idle_timeout.
    transport, handle = entry or ("livekit", session_id)

    try:
        if transport == "agora":
            import agora

            agora.stop_agent(handle)
        else:
            _run(_delete_room(handle))
    except Exception as exc:  # noqa: BLE001 — one already gone is not a failure
        logger.info("[session] stop %s: %s", session_id, exc)
    return jsonify({"ok": True})


@app.get("/health")
def health():
    return jsonify(
        {
            "ok": not _missing(),
            "missing": _missing(),
            # Which path this is actually running is the first thing to establish with
            # two transports, so it is reported rather than inferred.
            "transport": _transport(),
            "lanUrl": f"http://{_lan_ip()}:{HTTP_PORT}",
        }
    )


# ---------------------------------------------------------------- Plumbing


_loop: asyncio.AbstractEventLoop | None = None


def _ensure_loop() -> asyncio.AbstractEventLoop:
    """The background loop Flask's synchronous handlers hand coroutines to."""
    global _loop
    if _loop is None:
        _loop = asyncio.new_event_loop()
        threading.Thread(target=_loop.run_forever, daemon=True).start()
    return _loop


def _run(coro):
    """Run a coroutine on the background loop and wait for it."""
    return asyncio.run_coroutine_threadsafe(coro, _ensure_loop()).result(timeout=30)


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




_worker: subprocess.Popen | None = None


def _start_worker() -> None:
    """Start the agent worker alongside this server.

    Started here rather than left to the reader: without it the symptom is "the room
    opens but the avatar never says anything", with no error on either side.
    """
    global _worker
    # Agora hosts the conversation itself, so there is no worker to run on that path.
    if _transport() != "livekit":
        logger.info("[worker] not needed — transport is %s", _transport())
        return
    if _missing("livekit"):
        logger.warning("[worker] not started — credentials are missing")
        return
    _worker = subprocess.Popen(
        [sys.executable, str(Path(__file__).parent / "agent.py"), "start"],
        cwd=str(Path(__file__).parent),
        # Its own process group, so stopping it can take the whole tree down. The
        # worker forks children of its own to keep warm, and terminating only the
        # parent leaves those holding its health-check port — the next start then
        # fails with "address already in use" and no agent ever registers, which
        # presents as a room that connects but never has an avatar in it.
        start_new_session=True,
    )
    logger.info("[worker] started (pid %s)", _worker.pid)


def _stop_worker() -> None:
    """Stop the worker and every process it forked.

    Signals the group rather than the process: see start_new_session above.
    """
    global _worker
    if _worker is None:
        return
    try:
        os.killpg(os.getpgid(_worker.pid), signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        _worker.terminate()
    try:
        _worker.wait(timeout=5)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(os.getpgid(_worker.pid), signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            _worker.kill()
    _worker = None


def _restart_worker() -> None:
    _stop_worker()
    _start_worker()


atexit.register(_stop_worker)


if __name__ == "__main__":
    lan = _lan_ip()
    print("\n  RTC Mode server")
    print(f"  HTTP  http://0.0.0.0:{HTTP_PORT}   (LAN: http://{lan}:{HTTP_PORT})")
    print(f"  Transport: {_transport()}\n")

    _start_worker()

    if _transport() == "livekit" and not _missing("livekit"):
        # Anything left over from a previous run is closed before this one starts.
        # Ongoing cleanup is LiveKit's: empty_timeout and departure_timeout reap a
        # room whose participants have gone, which together with the client's own
        # stop covers every way out of a session.
        try:
            _run(_reap_orphans())
        except Exception as exc:  # noqa: BLE001 — startup must not fail over this
            logger.warning("[reap] skipped: %s", exc)

    # debug=False: the reloader runs this module twice, which would start a second
    # worker.
    app.run(host="0.0.0.0", port=HTTP_PORT, debug=False)
