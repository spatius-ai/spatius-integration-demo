"""LiveKit demo server.

The avatar joins the call itself. Audio travels on an RTC track and the motion Spatius
generates rides along encoded in the video stream, so **nothing streams through this
server** — it only issues the credentials to join a room and gets the agent into it.

That is the whole difference from the other two modes:

    Direct    client ──audio──► Motion Server        (client holds the connection)
    Backend   client ──mic───► server ──► Motion Server ──► client   (server does)
    LiveKit   client ◄────  LiveKit room  ────► agent + avatar       (neither does)

The conversation runs on this machine: this server starts the agent worker (agent.py)
for you, and its models go through LiveKit Inference, so you do not need an account
with each provider. For the same demo on Agora's Conversational AI Engine see
`../../../agora-demo`.

⚠️ This is a demo with no authentication. Anyone who can reach this address can start
a session, and sessions are billed. Add authentication and rate limiting before
putting it on a public network.
"""

from __future__ import annotations

import asyncio
import atexit
import json
import logging
import os
import signal
import socket
import subprocess
import sys
import threading
import uuid
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_cors import CORS

from agent import AGENT_NAME, DEFAULT_AVATAR_ID, normalize_language

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

# Everything this demo needs is in .env — the client sends nothing but the character
# it picked. The server checks these at startup and refuses to run without them, so a
# missing key surfaces once, in the terminal, rather than as a session that fails at
# the click.
REQUIRED_KEYS = [
    "SPATIUS_APP_ID",
    "SPATIUS_API_KEY",
    "LIVEKIT_URL",
    "LIVEKIT_API_KEY",
    "LIVEKIT_API_SECRET",
]

PLACEHOLDER_VALUES = {"your_spatius_api_key", "your_spatius_app_id"}

HINTS = {
    "SPATIUS_APP_ID": "https://app.spatius.ai/apps",
    "SPATIUS_API_KEY": "https://app.spatius.ai/apps",
    "LIVEKIT_URL": "https://cloud.livekit.io — wss://your-project.livekit.cloud",
    "LIVEKIT_API_KEY": "https://cloud.livekit.io — project settings, API keys",
    "LIVEKIT_API_SECRET": "https://cloud.livekit.io — shown only once, at creation",
}


def _env(key: str, default: str = "") -> str:
    return (os.getenv(key, default) or "").strip()


def _is_placeholder(value: str) -> bool:
    return value.strip().lower() in PLACEHOLDER_VALUES


def _missing() -> list[str]:
    """Everything this demo needs that is still unset."""
    return [k for k in REQUIRED_KEYS if not _env(k) or _is_placeholder(_env(k))]


def _language() -> str:
    """Which language the conversation runs in — set once, in .env."""
    return normalize_language(_env("CONVERSATION_LANGUAGE", "en"))


def _check_env_or_exit() -> None:
    """Refuse to start on an unfinished .env.

    Checked here rather than at the first request: a demo that boots and then fails
    one click later, with the reason on a browser console, is the slowest possible
    way to learn that a key was never filled in.
    """
    missing = _missing()
    if not missing:
        return
    print("\n  Cannot start: .env is incomplete.\n")
    for key in missing:
        print(f"    {key:<22} {HINTS.get(key, '')}")
    print(f"\n  Fill these in at {ENV_PATH} (copy .env.example if it is not there yet).\n")
    sys.exit(1)


# ---------------------------------------------------------------- Config


@app.get("/api/config")
def read_config():
    """The little the client needs to boot, and nothing secret.

    The App ID is public — it identifies the app to the SDK — so it goes out here;
    the API key never leaves this process. It is all a client needs: the character
    list is its own, and the avatar it picks rides on /api/session.
    """
    return jsonify({"appId": _env("SPATIUS_APP_ID")})


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


async def _create_room(room_name: str, metadata: str) -> None:
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
                    # The job's settings ride to the worker on the room: it is
                    # dispatched into existence and has no other way of knowing
                    # which avatar to join as, or which language to listen and
                    # reply in.
                    metadata=metadata,
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


# Open sessions, by room name. Recorded so that /api/session/stop can tell a room this
# server opened from an id it has never seen (which predates a restart).
_sessions: set[str] = set()
_sessions_lock = threading.Lock()


@app.post("/api/session")
def create_session():
    """Everything the client needs to join: a room, a token, and the agent on its way.

    ⚠️ Billing starts here — the client must call /api/session/stop when it leaves.
    """
    # The character the user picked is the only per-session choice there is;
    # everything else — language, voice, credentials — is fixed in .env.
    body = request.get_json(silent=True) or {}
    avatar_id = str(body.get("avatarId") or "").strip() or _env("SPATIUS_AVATAR_ID") or DEFAULT_AVATAR_ID

    try:
        return _create_livekit_session(avatar_id)
    except Exception as exc:  # noqa: BLE001 — everything becomes a JSON error
        logger.error("[session] create failed: %s", exc)
        return jsonify({"error": str(exc)}), 500


def _create_livekit_session(avatar_id: str):
    from livekit import api

    url, key, secret = _livekit_env()
    room_name = f"spatius-rtc-{uuid.uuid4().hex[:10]}"
    language = _language()
    # JSON rather than a bare string: the worker needs both the language and the
    # avatar the client picked, and a room carries exactly one metadata field.
    _run(_create_room(room_name, json.dumps({"language": language, "avatarId": avatar_id})))

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
        _sessions.add(room_name)

    logger.info("[session] created %s (%s, %s)", room_name, language, avatar_id)
    return jsonify(
        {
            "sessionId": room_name,
            "roomName": room_name,
            "url": url,
            "token": token,
            "avatarId": avatar_id,
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
        _sessions.discard(session_id)
    # An unknown id predates a restart. Session ids are room names, so it can still be
    # closed.
    try:
        _run(_delete_room(session_id))
    except Exception as exc:  # noqa: BLE001 — one already gone is not a failure
        logger.info("[session] stop %s: %s", session_id, exc)
    return jsonify({"ok": True})


@app.get("/health")
def health():
    # No "missing" list: startup refuses an incomplete .env, so a server that
    # answers at all is a configured one.
    return jsonify({"ok": True, "lanUrl": f"http://{_lan_ip()}:{HTTP_PORT}"})


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


atexit.register(_stop_worker)


if __name__ == "__main__":
    _check_env_or_exit()

    lan = _lan_ip()
    print("\n  LiveKit demo server")
    print(f"  HTTP  http://0.0.0.0:{HTTP_PORT}   (LAN: http://{lan}:{HTTP_PORT})\n")

    _start_worker()

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
