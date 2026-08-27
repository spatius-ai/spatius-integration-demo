from __future__ import annotations

from pathlib import Path
import logging

from fastapi import FastAPI, Request, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.config import (
    SAMPLE_AUDIO_HINT,
    get_settings,
    missing_for_scene,
    sample_clips,
    saved_config,
    validate_settings,
    write_env_file,
)
from app.session import BrowserSession


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

# Read once for the settings that only apply at startup (CORS). Everything else
# calls get_settings() when it is needed: saving from the config page clears the
# cache, and a handler holding this reference would keep serving what was on disk
# when the process started.
settings = get_settings()
app = FastAPI(title="Spatius Backend Mode Demo")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allow_origins or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthz")
async def healthz() -> JSONResponse:
    missing = validate_settings(get_settings())
    return JSONResponse({"ok": not missing, "missing": missing})


@app.get("/api/config")
async def config() -> JSONResponse:
    """What the client needs, plus whatever credentials are already saved.

    Answers even when nothing is configured yet: this is what the config page reads
    to populate itself, and refusing it would leave the user no way to fill it in.

    `missing` is per scene rather than one list — the pre-recorded scene needs only
    the Spatius credentials, so a server without LiveKit's is not unconfigured, it
    just cannot run the realtime one yet.
    """
    current = get_settings()
    return JSONResponse(
        {
            **saved_config(),
            **current.public_avatar_config,
            "missing": missing_for_scene(current),
            "clips": sample_clips(current),
            "clipsHint": SAMPLE_AUDIO_HINT,
        }
    )


@app.post("/api/config")
async def save_config(request: Request) -> JSONResponse:
    """Store what was filled in on the page, so the next visit — from this browser,
    another one, or a phone — starts with it already in place.

    Backend Mode keeps the credentials here rather than handing a token to the
    client, which is the one thing that differs from Direct Mode; the page that
    collects them is the same.
    """
    body = await request.json()
    saved = write_env_file(body if isinstance(body, dict) else {})
    return JSONResponse({"ok": True, "saved": saved})


@app.websocket("/ws/agent")
async def agent_websocket(websocket: WebSocket) -> None:
    # Fetched per connection, so a session started after a save uses the new
    # credentials rather than the ones read at startup.
    session = BrowserSession(websocket, get_settings())
    await session.run()


frontend_dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn

    settings = get_settings()

    # 0.0.0.0, not uvicorn's 127.0.0.1 default: a phone on the same network cannot
    # reach the dev machine's loopback address, so the mobile clients would find
    # nothing there. Having it here rather than only in the README means starting the
    # server any other way — an IDE run configuration, `python -m app.main` — still
    # lands somewhere the phone can reach.
    print("\n  Backend Mode server")
    print(f"  HTTP  http://0.0.0.0:{settings.server_port}\n")

    uvicorn.run(app, host="0.0.0.0", port=settings.server_port)
