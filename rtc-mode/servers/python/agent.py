"""The agent worker for RTC Mode.

RTC Mode is the one path where the avatar joins the call itself. The agent runs
here as a LiveKit worker, and `AvatarSession` puts Spatius into the same room: the
motion rides along encoded in the video stream's SEI, audio travels on an RTC
track, and the client's SDK parses the motion out to render.

Nothing streams through this server. Unlike Direct and Backend Mode, no audio or
motion passes through `server.py` at all — it only issues credentials and asks
LiveKit to dispatch this worker into a room.

Run by server.py, not by hand.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from livekit.agents import (
    Agent,
    AgentSession,
    AutoSubscribe,
    JobContext,
    WorkerOptions,
    cli,
    inference,
)
from livekit.plugins.spatius import AvatarSession

ENV_PATH = Path(__file__).parent / ".env"
load_dotenv(ENV_PATH)

logger = logging.getLogger(__name__)

# A public sample avatar any account can load, so the demo runs before an avatar of
# your own exists.
DEFAULT_AVATAR_ID = "41c62a7c-993c-4b6b-b6d3-549ce3c8be00"

# Personas, one per language. Spoken style, no Markdown — every character is read
# aloud.
#
# The persona has to follow the UI language as well as recognition does: with the
# English one in place, speaking Chinese gets an English reply, which reads as the
# avatar ignoring you rather than as a setting being wrong.
PROMPTS = {
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

AGENT_NAME = "spatius-rtc-demo"


async def entrypoint(ctx: JobContext) -> None:
    # Re-read on every job: the config page writes changes back to .env, but this
    # process read its copy at start, so without this a saved change would need a
    # restart to take effect. override=True is what makes it replace what is already
    # in the process.
    load_dotenv(ENV_PATH, override=True)

    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    # The UI language, which the server puts in the room metadata. Read before the
    # session is built: recognition and synthesis both need it, and a session
    # constructed with the wrong one cannot be corrected afterwards.
    lang = (ctx.room.metadata or "en").strip()
    language = "zh" if lang.lower().startswith("zh") else "en"

    session = AgentSession(
        # Recognition follows the UI language. Left on the wrong one it transcribes
        # speech into nonsense and the LLM answers the nonsense, which presents as
        # the avatar replying to something nobody said.
        stt=inference.STT(
            model=os.getenv("STT_MODEL", "deepgram/nova-3"), language=language
        ),
        llm=inference.LLM(model=os.getenv("LLM_MODEL", "openai/gpt-4.1-mini")),
        # The accent comes from the voice rather than from `language`: some default
        # voices read Chinese with an accent — pin one with TTS_VOICE if that matters.
        tts=inference.TTS(
            model=os.getenv("TTS_MODEL", "cartesia/sonic-2"),
            language=language,
            **({"voice": v} if (v := os.getenv("TTS_VOICE", "").strip()) else {}),
        ),
        # How long to wait before deciding the user has finished talking. The default
        # ceiling is 2.5s and the turn detector reaches it on most conversational
        # lines, which is the single largest part of the delay before a reply.
        turn_handling={
            "endpointing": {
                "min_delay": 0.3,
                "max_delay": float(os.getenv("ENDPOINTING_MAX_DELAY", "0.5")),
            }
        },
    )

    # What makes this RTC Mode: the avatar joins the room. Audio travels on an RTC
    # track and the motion Spatius generates rides along on the video track, so the
    # client renders from the stream rather than being fed by a server.
    avatar = AvatarSession(
        api_key=os.getenv("SPATIUS_API_KEY", ""),
        app_id=os.getenv("SPATIUS_APP_ID", ""),
        avatar_id=os.getenv("SPATIUS_AVATAR_ID", "") or DEFAULT_AVATAR_ID,
    )
    await avatar.start(session, room=ctx.room)

    @session.on("session_usage_updated")
    def _on_usage(ev) -> None:  # noqa: ANN001 — the event type is internal
        # Between speaking and hearing a reply sit three cloud services in series;
        # which one is slow is not something you can tell by feel.
        logger.info("usage: %s", getattr(ev, "usage", ev))

    await session.start(agent=Agent(instructions=PROMPTS[language]), room=ctx.room)

    # Announce readiness, which is what the client waits for before speaking.
    #
    # "The agent joined" is not enough: at join time AgentSession is still starting
    # up, and audio arriving then is dropped. Waiting for it to publish an audio
    # track does not work either — it is TTS-driven, so there is no track until it
    # speaks.
    await ctx.room.local_participant.set_attributes({"ready": "1"})


if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            agent_name=AGENT_NAME,
            # Keep one process warm: the default spawns on demand, and that cold
            # start lands directly in the wait after pressing Enter.
            num_idle_processes=1,
        )
    )
