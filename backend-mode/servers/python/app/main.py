from __future__ import annotations

import logging

from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import require_complete_settings
from app.session import BrowserSession


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

# Read once, at import. Everything — credentials, region, language, models — lives in
# `.env`, so there is nothing that can change while the process runs; and an
# incomplete file stops the server here rather than at the first avatar.
settings = require_complete_settings()

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
    return JSONResponse({"ok": True})


@app.get("/api/config")
async def config() -> JSONResponse:
    """What a client needs to boot the SDK, and nothing else.

    Read-only, and free of credentials: in Backend Mode this server holds the Motion
    Server connection, so a client never authenticates against Spatius and has no use
    for a key. The app id and region go to `AvatarSDK.initialize`, the avatar id is
    the character the playground opens with, the sample rates describe the audio on
    the WebSocket.
    """
    return JSONResponse(settings.public_avatar_config)


@app.websocket("/ws/agent")
async def agent_websocket(websocket: WebSocket) -> None:
    session = BrowserSession(websocket, settings)
    await session.run()


if __name__ == "__main__":
    import uvicorn

    # 0.0.0.0, not uvicorn's 127.0.0.1 default: a phone on the same network cannot
    # reach the dev machine's loopback address, so the mobile clients would find
    # nothing there. Having it here rather than only in the README means starting the
    # server any other way — an IDE run configuration, `python -m app.main` — still
    # lands somewhere the phone can reach.
    print("\n  Backend Mode server")
    print(f"  HTTP  http://0.0.0.0:{settings.server_port}\n")

    uvicorn.run(app, host="0.0.0.0", port=settings.server_port)
