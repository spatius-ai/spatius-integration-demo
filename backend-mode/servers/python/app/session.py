"""One browser connection, and the two scenes it can drive.

Backend Mode: this server owns the Motion Server connection, so the client is thin
— it captures microphone audio and renders what comes back, and never talks to
Spatius itself. Both scenes therefore produce the same thing on the wire, encoded
audio plus motion messages, and differ only in where the audio came from:

    pre-recorded  a bundled .pcm file  ─────────────────►  avatar session
    realtime      mic ──ws──► agent (ASR/LLM/TTS) ──────►  avatar session

Audio is driven as it arrives rather than collected first: this backend holds the
avatar connection, so a reply can start moving the mouth while it is still being
synthesized.
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import json
import logging
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import WebSocket
from fastapi.websockets import WebSocketDisconnect

from app.agent import RealtimeAgent
from app.avatar.turn import AvatarTurn, AvatarTurnEvent
from app.config import Settings, missing_for_scene


logger = logging.getLogger(__name__)

# How much of the pre-recorded clip to hand over at a time. ~64ms at 16 kHz PCM16 —
# streamed rather than sent whole because that is what a real source looks like, and
# it is the same call either way.
SAMPLE_CHUNK_BYTES = 2048


class BrowserSession:
    def __init__(self, websocket: WebSocket, settings: Settings) -> None:
        self._websocket = websocket
        self._settings = settings
        self._send_lock = asyncio.Lock()
        self._avatar_turn: AvatarTurn | None = None
        self._avatar_turn_task: asyncio.Task[None] | None = None
        self._active_turn_id: str | None = None
        self._client_avatar_id: str | None = None
        self._agent: RealtimeAgent | None = None
        self._sample_task: asyncio.Task[None] | None = None

    async def run(self) -> None:
        await self._websocket.accept()
        await self._send(
            {
                "type": "ready",
                "sessionId": str(uuid4()),
                "avatar": self._settings.public_avatar_config,
                "missing": missing_for_scene(self._settings),
            }
        )

        try:
            while True:
                payload = await self._websocket.receive_json()
                await self._handle_client_message(payload)
        except WebSocketDisconnect:
            logger.info("browser websocket disconnected")
        finally:
            await self.close()

    async def close(self) -> None:
        if self._sample_task is not None:
            self._sample_task.cancel()
            self._sample_task = None
        if self._agent is not None:
            await self._agent.aclose()
            self._agent = None
        await self._close_avatar_turn()

    # ── Client protocol ────────────────────────────────────────────
    #
    #   client → server   {type: "set_avatar", avatarId}
    #                     {type: "play_sample", clip}           pre-recorded scene
    #                     {type: "start_agent", language?}     realtime scene
    #                     {type: "mic_audio", audio}           base64 PCM16
    #                     {type: "text", text}                 speak a typed line
    #                     {type: "interrupt"}
    #   server → client   {type: "ready", avatar, missing}
    #                     {type: "avatar_audio", audio, isLast}
    #                     {type: "avatar_frames", frames[], isLast}
    #                     {type: "agent_ready"}
    #                     {type: "transcript", role, text}
    #                     {type: "interrupt", reason}
    #                     {type: "status", message} / {type: "error", message}

    async def _handle_client_message(self, payload: dict[str, Any]) -> None:
        kind = payload.get("type")

        if kind == "ping":
            await self._send({"type": "pong"})

        elif kind == "set_avatar":
            avatar_id = str(payload.get("avatarId", "")).strip()
            if avatar_id:
                self._client_avatar_id = avatar_id
                await self._send_status(f"Avatar ID set to: {avatar_id}")

        elif kind == "play_sample":
            if self._sample_task is not None and not self._sample_task.done():
                return
            self._sample_task = asyncio.create_task(
                self._play_sample(str(payload.get("clip") or ""))
            )

        elif kind == "start_agent":
            await self._start_agent(str(payload.get("language") or "en"))

        elif kind == "mic_audio":
            audio_b64 = str(payload.get("audio", ""))
            if audio_b64 and self._agent is not None:
                self._agent.push_audio(base64.b64decode(audio_b64))

        elif kind == "text":
            text = str(payload.get("text", "")).strip()
            if text and self._agent is not None:
                await self._agent.say(text)

        elif kind == "interrupt":
            await self._interrupt_current_turn(reason="client_interrupt")

        else:
            await self._send({"type": "error", "message": f"Unsupported message: {kind}"})

    # ── Scene one: a clip that ships with the demo ────────────────

    def _assets_dir(self) -> Path:
        configured = self._settings.sample_audio_file
        if configured:
            return Path(configured).expanduser()
        return Path(__file__).resolve().parents[1] / "assets"

    def _sample_audio_path(self, name: str) -> Path | None:
        """Resolve a clip name to a file inside the assets directory.

        Resolved and then checked to be under that directory: the name arrives from
        the client, and without this a path like `../../.env` would be read and
        streamed straight back out.
        """
        directory = self._assets_dir().resolve()
        candidate = (directory / name).resolve()
        if directory not in candidate.parents or not candidate.is_file():
            return None
        return candidate

    async def _play_sample(self, name: str) -> None:
        """Drive the avatar from a bundled file. No models, no credentials beyond
        the Spatius pair — the smallest thing that proves the whole path works."""
        path = self._sample_audio_path(name)
        if path is None:
            await self._send({"type": "error", "message": f"Unknown clip: {name}"})
            return

        audio = path.read_bytes()
        try:
            turn_id = await self._open_avatar_turn()
            for offset in range(0, len(audio), SAMPLE_CHUNK_BYTES):
                chunk = audio[offset : offset + SAMPLE_CHUNK_BYTES]
                is_last = offset + SAMPLE_CHUNK_BYTES >= len(audio)
                await self._drive_audio(turn_id, chunk, end=is_last)
            await self._end_turn(turn_id)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 — reaches the user as a toast
            logger.error("sample playback failed: %s", exc)
            await self._send({"type": "error", "message": str(exc)})

    # ── Scene two: talk to the avatar ─────────────────────────────

    async def _start_agent(self, language: str) -> None:
        if self._agent is not None:
            await self._send({"type": "agent_ready"})
            return

        missing = missing_for_scene(self._settings)["realtime"]
        if missing:
            await self._send(
                {"type": "error", "message": f"missing config: {', '.join(missing)}"}
            )
            return

        # One turn spans a whole reply, and the agent streams it in pieces, so the
        # turn id is held here rather than passed through every callback.
        turn_id: dict[str, str | None] = {"id": None}

        async def on_audio(pcm: bytes) -> None:
            if turn_id["id"] is None:
                turn_id["id"] = await self._open_avatar_turn()
            await self._drive_audio(turn_id["id"], pcm, end=False)

        async def on_turn_end() -> None:
            current = turn_id["id"]
            turn_id["id"] = None
            if current is not None:
                # The empty final send is what tells the avatar the turn is over, so
                # it returns to idle rather than holding the last mouth shape.
                await self._drive_audio(current, b"", end=True)
                await self._end_turn(current)

        async def on_interrupt() -> None:
            turn_id["id"] = None
            await self._interrupt_current_turn(reason="agent_interrupt")

        agent = RealtimeAgent(
            self._settings,
            on_audio=on_audio,
            on_turn_end=on_turn_end,
            on_interrupt=on_interrupt,
            on_transcript=lambda role, text: asyncio.create_task(
                self._send({"type": "transcript", "role": role, "text": text})
            ),
            language=language,
        )
        try:
            await agent.start()
        except Exception as exc:  # noqa: BLE001 — reaches the user as a toast
            logger.exception("agent start failed")
            await self._send({"type": "error", "message": str(exc)})
            return

        self._agent = agent
        await self._send({"type": "agent_ready"})

    # ── Driving the avatar ────────────────────────────────────────

    async def _open_avatar_turn(self) -> str:
        """Start a turn on the Motion Server connection this backend owns.

        The id it returns stays on this side: it only exists so audio and frames
        arriving after an interruption can be recognised as belonging to a turn
        that is over and dropped. Clients see an ordered stream and need no id.
        """
        await self._close_avatar_turn()
        turn_id = str(uuid4())
        turn = AvatarTurn(
            self._settings,
            turn_id=turn_id,
            avatar_id=self._client_avatar_id,
        )
        await turn.start()
        self._avatar_turn = turn
        self._active_turn_id = turn_id
        self._avatar_turn_task = asyncio.create_task(self._forward_avatar_frames(turn))
        return turn_id

    async def _drive_audio(self, turn_id: str, audio: bytes, *, end: bool) -> None:
        """Hand audio to the avatar, and mirror it to the client to play.

        Both are needed: the client renders motion but has no audio of its own, and
        the avatar generates motion but does not send audio back.
        """
        if turn_id != self._active_turn_id:
            return
        if audio:
            await self._send(
                {
                    "type": "avatar_audio",
                    "audio": base64.b64encode(audio).decode("ascii"),
                    "isLast": False,
                }
            )
        turn = self._avatar_turn
        if turn is not None:
            await turn.send_audio(audio, end=end)

    async def _end_turn(self, turn_id: str) -> None:
        if turn_id != self._active_turn_id:
            return
        await self._send({"type": "avatar_audio", "audio": "", "isLast": True})

    async def _forward_avatar_frames(self, turn: AvatarTurn) -> None:
        try:
            while True:
                event = await turn.queue.get()
                await self._handle_avatar_event(turn.turn_id, event)
                if event.kind == "frame" and event.is_last:
                    await turn.close()
                    if self._avatar_turn is turn:
                        self._avatar_turn = None
                        self._active_turn_id = None
                    return
                if event.kind in {"error", "closed"}:
                    return
        except asyncio.CancelledError:
            raise

    async def _handle_avatar_event(self, turn_id: str, event: AvatarTurnEvent) -> None:
        if turn_id != self._active_turn_id:
            return
        if event.kind == "frame":
            await self._send(
                {
                    "type": "avatar_frames",
                    "frames": [base64.b64encode(event.frame).decode("ascii")],
                    "isLast": event.is_last,
                }
            )
        elif event.kind == "error":
            await self._send(
                {"type": "error", "message": f"Avatar turn failed: {event.message}"}
            )

    # ── Helpers ────────────────────────────────────────────────────

    async def _interrupt_current_turn(self, *, reason: str) -> None:
        if self._sample_task is not None:
            self._sample_task.cancel()
            self._sample_task = None
        if self._agent is not None:
            self._agent.interrupt()
        await self._send({"type": "interrupt", "reason": reason})
        await self._close_avatar_turn()

    async def _close_avatar_turn(self) -> None:
        turn_task = self._avatar_turn_task
        self._avatar_turn_task = None
        if turn_task is not None:
            turn_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await turn_task
        turn = self._avatar_turn
        self._avatar_turn = None
        self._active_turn_id = None
        if turn is not None:
            await turn.close()

    async def _send_status(self, message: str) -> None:
        await self._send({"type": "status", "message": message})

    async def _send(self, payload: dict[str, Any]) -> None:
        async with self._send_lock:
            await self._websocket.send_text(json.dumps(payload, ensure_ascii=False))
