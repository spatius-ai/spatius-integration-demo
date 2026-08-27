"""The realtime scene's voice agent.

The conversation runs here — ASR, LLM and TTS — but the avatar does not. This is
Direct Mode: the client holds the Motion Server connection, so what this returns is
plain PCM, and the browser hands it to `controller.send()` itself.

That is why there is no LiveKit room in this file. `AgentSession` only builds a
RoomIO when its audio input and output are unset; setting both up front keeps the
whole session local, and the microphone arrives (and the reply leaves) over the
client's own WebSocket. The client therefore needs no LiveKit SDK, and the two
scenes converge on the same client code: both end at `controller.send(pcm)`.

Models go through LiveKit Inference, so the only credentials are LiveKit's and
Spatius'.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from typing import Callable

from contextlib import AbstractAsyncContextManager

from livekit import rtc
from livekit.agents import Agent, AgentSession, inference
from livekit.agents.utils import http_context
from livekit.agents.voice.io import AudioInput, AudioOutput, AudioOutputCapabilities

import config

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


def _speech_language(language: str) -> str:
    """Normalise whatever the client sent to a language the models accept."""
    return "zh" if (language or "").lower().startswith("zh") else "en"


class WebSocketAudioInput(AudioInput):
    """The browser's microphone, arriving as PCM16 over the client's WebSocket.

    A queue rather than a stream the session pulls from directly: frames arrive when
    the browser sends them, and the session consumes them on its own schedule.
    """

    def __init__(self) -> None:
        super().__init__(label="websocket-mic")
        self._queue: asyncio.Queue[rtc.AudioFrame | None] = asyncio.Queue()

    def push(self, pcm16: bytes) -> None:
        """Hand one chunk of microphone audio to the session."""
        if not pcm16:
            return
        samples = len(pcm16) // 2
        if samples == 0:
            return
        self._queue.put_nowait(
            rtc.AudioFrame(
                data=pcm16,
                sample_rate=config.SAMPLE_RATE,
                num_channels=config.NUM_CHANNELS,
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


class WebSocketAudioOutput(AudioOutput):
    """Where the agent's synthesized speech goes: back down the client's WebSocket.

    In the usual LiveKit setup this would be a track published into a room. Here the
    client is the thing driving the avatar, so the audio is handed to it as bytes and
    it decides what to do with them — which, in Direct Mode, is `controller.send()`.
    """

    def __init__(
        self,
        on_audio: Callable[[bytes], None],
        on_flush: Callable[[], None],
        on_clear: Callable[[], None],
    ) -> None:
        super().__init__(
            label="websocket-out",
            capabilities=AudioOutputCapabilities(pause=False),
            sample_rate=config.SAMPLE_RATE,
        )
        self._on_audio = on_audio
        self._on_flush = on_flush
        self._on_clear = on_clear
        # How much audio this segment has carried, so playback_finished can report a
        # position. The session waits on that event before considering a turn over.
        self._position = 0.0

    async def capture_frame(self, frame: rtc.AudioFrame) -> None:
        await super().capture_frame(frame)
        data = bytes(frame.data)
        self._position += frame.samples_per_channel / frame.sample_rate
        self._on_audio(data)

    def flush(self) -> None:
        super().flush()
        self._on_flush()
        # Report the segment as played out. Nothing here can observe real playback —
        # the audio is already on its way to a browser that owns the timing — so the
        # turn is complete as soon as the last frame has been forwarded. Without this
        # the session waits forever and never listens for the next question.
        self.on_playback_finished(playback_position=self._position, interrupted=False)
        self._position = 0.0

    def clear_buffer(self) -> None:
        # The user started talking over the reply. Tell the client to drop what it has
        # not played yet, or the interrupted line keeps coming out of the avatar.
        self._on_clear()
        self._position = 0.0


class RealtimeAgent:
    """One conversation, bound to one client WebSocket.

    Created per connection: the session carries the conversation's own state, and two
    browsers sharing one would hear each other's replies.
    """

    def __init__(
        self,
        on_audio: Callable[[bytes], None],
        on_turn_end: Callable[[], None],
        on_interrupt: Callable[[], None],
        on_transcript: Callable[[str, str], None] | None = None,
        instructions: str = "",
        language: str = "en",
    ) -> None:
        self._input = WebSocketAudioInput()
        self._output = WebSocketAudioOutput(on_audio, on_turn_end, on_interrupt)
        self._on_transcript = on_transcript
        self._language = _speech_language(language)
        self._instructions = (
            instructions
            or config.env("LLM_SYSTEM_PROMPT")
            or DEFAULT_INSTRUCTIONS[self._language]
        )
        self._session: AgentSession | None = None
        self._http_ctx: AbstractAsyncContextManager | None = None

    async def start(self) -> None:
        # The STT/LLM/TTS plugins fetch their HTTP session from the worker's job
        # context, which does not exist here — this agent runs inside the web
        # server rather than under the agent worker, which is what keeps it out of
        # a LiveKit room. Opening the context by hand is the documented way to use
        # the plugins outside a worker.
        #
        # Without it everything looks fine until the first reply, when TTS fails
        # with "Attempted to use an http session outside of a job context" and the
        # avatar simply never speaks.
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
            stt=inference.STT(
                model=config.env("STT_MODEL", "deepgram/nova-3"),
                language=self._language,
            ),
            llm=inference.LLM(model=config.env("LLM_MODEL", "openai/gpt-4.1-mini")),
            # Synthesis follows the session's language too. Note the accent comes
            # from the voice rather than from `language`: some providers' default
            # voices read Chinese with an accent, and only a few give you Mandarin —
            # pin one with TTS_VOICE if that matters.
            tts=inference.TTS(
                model=config.env("TTS_MODEL", "cartesia/sonic-2"),
                language=self._language,
                **({"voice": v} if (v := config.env("TTS_VOICE")) else {}),
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
        """Speak a fixed line. Used for the greeting, and for text typed in the UI."""
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
        if self._http_ctx is not None:
            # Closed after the session below, so nothing is still reaching for it.
            http_ctx, self._http_ctx = self._http_ctx, None
        else:
            http_ctx = None
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
