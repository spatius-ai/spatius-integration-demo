"""The realtime scene's voice agent.

Backend Mode: this server owns the Motion Server connection, so the agent's speech
never leaves the backend as audio-to-be-driven — it goes straight into the avatar
session here, and the client receives the same encoded audio + motion messages the
pre-recorded scene produces. Clients stay thin either way.

There is no LiveKit room in this file. `AgentSession` only builds a RoomIO when its
audio input and output are unset; setting both up front keeps the session local, so
the microphone arrives over the client's WebSocket and the reply is handed to a
callback rather than published to a room.

Models go through LiveKit Inference, so the only credentials are LiveKit's and
Spatius'.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import AbstractAsyncContextManager
from typing import Awaitable, Callable

from livekit import rtc
from livekit.agents import Agent, AgentSession, inference
from livekit.agents.utils import http_context
from livekit.agents.voice.io import AudioInput, AudioOutput, AudioOutputCapabilities

from app.config import Settings

logger = logging.getLogger(__name__)

# Personas, one per language. Spoken style, no Markdown — every character is read
# aloud.
#
# The persona has to follow the UI language as well as recognition does: with the
# English one in place, speaking Chinese gets an English reply, which reads as the
# avatar ignoring you rather than as a setting being wrong.
DEFAULT_INSTRUCTIONS = {
    "en": (
        "You are a friendly avatar assistant in a demo. Reply in spoken English, at "
        "most 50 words each time. Do not use Markdown or any symbol formatting — every "
        "character you write is read aloud."
    ),
    "zh": (
        "你是一个友好的数字人助手，正在做产品演示。用口语化的中文回答，每次不超过 60 字。"
        "不要使用 Markdown 或任何符号排版，你说的每一个字都会被朗读出来。"
    ),
}


def speech_language(language: str) -> str:
    """Normalise whatever the client sent to a language the models accept."""
    return "zh" if (language or "").lower().startswith("zh") else "en"


class WebSocketAudioInput(AudioInput):
    """The browser's microphone, arriving as PCM16 over the client's WebSocket."""

    def __init__(self, sample_rate: int) -> None:
        super().__init__(label="websocket-mic")
        self._sample_rate = sample_rate
        self._queue: asyncio.Queue[rtc.AudioFrame | None] = asyncio.Queue()

    def push(self, pcm16: bytes) -> None:
        if not pcm16:
            return
        samples = len(pcm16) // 2
        if samples == 0:
            return
        self._queue.put_nowait(
            rtc.AudioFrame(
                data=pcm16,
                sample_rate=self._sample_rate,
                num_channels=1,
                samples_per_channel=samples,
            )
        )

    def close(self) -> None:
        self._queue.put_nowait(None)

    async def __anext__(self) -> rtc.AudioFrame:
        frame = await self._queue.get()
        if frame is None:
            raise StopAsyncIteration
        return frame

    def __aiter__(self) -> AsyncIterator[rtc.AudioFrame]:
        return self


class AvatarAudioOutput(AudioOutput):
    """Where the agent's speech goes: into the avatar, as it is synthesized.

    Streamed rather than collected: this backend holds the Motion Server connection,
    so audio can be driven while it is still being produced. Waiting for the whole
    reply would add its full synthesis time before the avatar moves at all.
    """

    def __init__(
        self,
        sample_rate: int,
        on_audio: Callable[[bytes], Awaitable[None]],
        on_flush: Callable[[], Awaitable[None]],
        on_clear: Callable[[], Awaitable[None]],
    ) -> None:
        super().__init__(
            label="avatar-out",
            capabilities=AudioOutputCapabilities(pause=False),
            sample_rate=sample_rate,
        )
        self._on_audio = on_audio
        self._on_flush = on_flush
        self._on_clear = on_clear
        # How much audio this segment has carried, so playback_finished can report a
        # position. The session waits on that event before considering a turn over.
        self._position = 0.0

    async def capture_frame(self, frame: rtc.AudioFrame) -> None:
        await super().capture_frame(frame)
        self._position += frame.samples_per_channel / frame.sample_rate
        await self._on_audio(bytes(frame.data))

    def flush(self) -> None:
        super().flush()
        # Scheduled rather than awaited: flush() is synchronous, and the end-of-turn
        # work (closing the avatar turn) is not.
        asyncio.create_task(self._on_flush())
        # Report the segment as played out. Nothing here can observe real playback —
        # the audio is already on its way to a client that owns the timing — so the
        # turn is complete once the last frame has been forwarded. Without this the
        # session waits forever and never listens for the next question.
        self.on_playback_finished(playback_position=self._position, interrupted=False)
        self._position = 0.0

    def clear_buffer(self) -> None:
        # The user talked over the reply; drop what has not been driven yet.
        asyncio.create_task(self._on_clear())
        self._position = 0.0


class RealtimeAgent:
    """One conversation, bound to one client WebSocket."""

    def __init__(
        self,
        settings: Settings,
        *,
        on_audio: Callable[[bytes], Awaitable[None]],
        on_turn_end: Callable[[], Awaitable[None]],
        on_interrupt: Callable[[], Awaitable[None]],
        on_transcript: Callable[[str, str], None] | None = None,
        language: str = "en",
    ) -> None:
        self._settings = settings
        self._language = speech_language(language)
        self._input = WebSocketAudioInput(settings.user_input_sample_rate)
        self._output = AvatarAudioOutput(
            settings.avatar_output_sample_rate, on_audio, on_turn_end, on_interrupt
        )
        self._on_transcript = on_transcript
        self._instructions = (
            settings.llm_system_prompt or DEFAULT_INSTRUCTIONS[self._language]
        )
        self._session: AgentSession | None = None
        self._http_ctx: AbstractAsyncContextManager | None = None

    async def start(self) -> None:
        # The STT/LLM/TTS plugins fetch their HTTP session from the worker's job
        # context, which does not exist here — this agent runs inside the web server
        # rather than under the agent worker, which is what keeps it out of a
        # LiveKit room. Opening the context by hand is the documented way to use the
        # plugins outside a worker.
        #
        # Without it everything looks fine until the first reply, when TTS fails with
        # "Attempted to use an http session outside of a job context" and the avatar
        # simply never speaks.
        self._http_ctx = http_context.open()
        await self._http_ctx.__aenter__()

        try:
            await self._start()
        except Exception:
            # The caller drops the agent on a failed start, so aclose() never runs
            # and the session opened above would be left behind.
            await self.aclose()
            raise

    async def _start(self) -> None:
        session = AgentSession(
            # Recognition has to follow the UI language: left on the wrong one it
            # transcribes speech into nonsense and the LLM answers the nonsense,
            # which presents as the avatar replying to something nobody said.
            stt=inference.STT(model=self._settings.stt_model, language=self._language),
            llm=inference.LLM(model=self._settings.llm_model),
            # Note the accent comes from the voice rather than from `language`: some
            # providers' default voices read Chinese with an accent — pin one with
            # TTS_VOICE if that matters.
            tts=inference.TTS(
                model=self._settings.tts_model,
                language=self._language,
                **({"voice": v} if (v := self._settings.tts_voice) else {}),
            ),
        )
        self._session = session

        if self._on_transcript is not None:

            @session.on("conversation_item_added")
            def _on_item(event) -> None:  # noqa: ANN001 — the event type is internal
                item = getattr(event, "item", None)
                role = getattr(item, "role", None)
                text = (getattr(item, "text_content", None) or "").strip()
                if role in ("user", "assistant") and text:
                    self._on_transcript(role, text)

        # Bound before start(), which is what keeps this session out of a room: with
        # both ends already set, AgentSession has no reason to build a RoomIO.
        session.input.audio = self._input
        session.output.audio = self._output

        await session.start(agent=Agent(instructions=self._instructions))

    def push_audio(self, pcm16: bytes) -> None:
        self._input.push(pcm16)

    async def say(self, text: str) -> None:
        """Speak a fixed line. Used for text typed in the UI."""
        if self._session is None:
            return
        self._session.interrupt()
        handle = self._session.say(text)
        await handle.wait_for_playout()

    def interrupt(self) -> None:
        if self._session is not None:
            self._session.interrupt()

    async def aclose(self) -> None:
        self._input.close()
        http_ctx, self._http_ctx = self._http_ctx, None

        if self._session is not None:
            try:
                await self._session.aclose()
            except Exception as exc:  # noqa: BLE001 — teardown must not mask the real error
                logger.warning("agent session close failed: %s", exc)
            self._session = None

        if http_ctx is not None:
            # Its connection pool would otherwise be left open, one per conversation.
            try:
                await http_ctx.__aexit__(None, None, None)
            except Exception as exc:  # noqa: BLE001 — same: teardown, not the real error
                logger.warning("http context close failed: %s", exc)
