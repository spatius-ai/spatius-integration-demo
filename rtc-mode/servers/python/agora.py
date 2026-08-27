"""The Agora transport: orchestrating ConvoAI.

The division of labour differs from the LiveKit transport — that one runs an agent
process of its own (`agent.py`), this one does not: ASR / LLM / TTS and the avatar are
all hosted by Agora's Conversational AI Engine, and this server only signs tokens and
calls REST.

The avatar goes in as a ConvoAI avatar vendor (`avatar.vendor = "spatius"`): the engine
feeds TTS audio to Spatius, Spatius generates motion data and joins the same Agora
channel as its own publisher, and the client's AvatarKit subscribes and renders locally.
What travels through the channel is audio plus motion data, not rendered video — which
is the same arrangement as the LiveKit transport, reached a different way.

A session has three RTC participants: the user (client), the conversational agent, and
the avatar publisher. Agora does not allow uid collisions, so the three draw from
non-overlapping ranges.

Models and voice come from the agent that `AGORA_PIPELINE_ID` points at — built,
configured and published in the Agora console; this only references it. That is why the
user does not have to sign up with each LLM and TTS provider.
"""

from __future__ import annotations

import os
import secrets
from dataclasses import dataclass

import requests

from agent import DEFAULT_AVATAR_ID
from agora_token import Role_Publisher, RtcTokenBuilder

# UID ranges, non-overlapping across the three participants.
UID_RANGES = {
    "user": (100_000, 599_999),
    "agent": (600_000, 799_999),
    "avatar": (800_000, 999_999),
}

SESSION_TTL_SECONDS = 30 * 60
# How long ConvoAI waits with no remote user in the channel before stopping the agent.
# A backstop — the client still has to stop explicitly, since this minute is billed.
IDLE_TIMEOUT_SECONDS = 60

# Sample rates Motion Server accepts (see docs.spatius.ai/concepts/audio).
SUPPORTED_SAMPLE_RATES = (8_000, 16_000, 22_050, 24_000, 32_000, 44_100, 48_000)
DEFAULT_AVATAR_SAMPLE_RATE = 24_000

REQUEST_TIMEOUT_SECONDS = 20
# Lifetime of the REST auth token. It is used immediately after signing, so five
# minutes is plenty.
REST_AUTH_TOKEN_TTL_SECONDS = 5 * 60

DEFAULT_CONVOAI_BASE_URL = "https://api.agora.io"

# Speech recognition, as configured on the agent this demo was built against. Running
# it against a different agent means replacing all four — see the README.
ASR_VENDOR = "deepgram"
ASR_MODEL = "nova-3"
# One credential id per language: a credential serves the language it was created for,
# and pointing at the wrong one silently stops recognition working at all.
ASR_RESOURCE_ZH = "9231f363-1ebd-4156-8fc9-b313abe2ae23"
ASR_RESOURCE_EN = "0bddc644c90140428e058a876d7d70e7"

# The persona, kept in sync with the LiveKit transport (`agent.py`): the avatar should
# behave the same whichever way it is reached, so changing one means changing the other.
PROMPTS = {
    "en": (
        "You are a friendly digital human in a live demo. Keep replies short and "
        "conversational — at most 50 words. Do not use Markdown or any symbol "
        "formatting: every character you write will be read aloud."
    ),
    "zh": (
        "你是一个演示中的数字人，正在和用户对话。用口语化的中文回答，每次不超过 50 字。"
        "不要使用 Markdown 或任何符号排版，你说的每一个字都会被朗读出来。"
    ),
}


def _avatar_sample_rate() -> int:
    """The avatar's audio sample rate, which **must equal the TTS output rate**.

    Motion Server supports the rates in SUPPORTED_SAMPLE_RATES but does not resample: a
    mismatch is simply silent — the avatar joins, publishes and reports its track as
    playing, the volume stays at zero, and neither side reports an error.

    24000 is the default and also what TTS providers that do not expose the setting
    (OpenAI, for one) actually emit, so it rarely needs changing.

    Read on every call rather than as a module-level constant: a constant is evaluated
    at import, before the .env the config page writes back has been loaded, so changes
    would not take effect.
    """
    configured = (os.getenv("AGORA_AVATAR_SAMPLE_RATE") or "").strip()
    return int(configured or DEFAULT_AVATAR_SAMPLE_RATE)


class AgoraConfigError(RuntimeError):
    """Missing credentials or invalid configuration."""


@dataclass
class AgoraSession:
    """Connection credentials for one session, returned to the client."""

    agent_id: str
    app_id: str
    channel_name: str
    token: str
    uid: int
    avatar_id: str
    spatius_app_id: str
    spatius_region: str
    # The conversational agent's uid. The client uses it to tell whether the agent has
    # joined — ConvoAI starts it asynchronously after /join returns and it takes a
    # second or two to arrive; anything sent in that window is dropped.
    agent_uid: int


def _require(key: str) -> str:
    value = (os.getenv(key) or "").strip()
    if not value:
        raise AgoraConfigError(f"{key} is not configured (see .env.example)")
    return value


def _random_uid(kind: str) -> int:
    low, high = UID_RANGES[kind]
    return low + secrets.randbelow(high - low + 1)


def _base_url() -> str:
    configured = (os.getenv("AGORA_CONVOAI_BASE_URL") or "").strip()
    return (configured or DEFAULT_CONVOAI_BASE_URL).rstrip("/")


def _auth_header() -> str:
    """REST authentication for ConvoAI.

    Signs a short-lived AccessToken2 on the spot from the App ID and certificate and
    puts it in the Authorization header. It is the same signing path as the join token,
    which is why the static Customer ID / Secret pair is not needed — two fewer things
    for the user to fill in. The channel is an empty string (a wildcard): the REST layer
    only verifies the signature, not channel ownership. The uid carries no meaning here,
    so it is fixed.
    """
    token = RtcTokenBuilder.build_token_with_uid(
        _require("AGORA_APP_ID"),
        _require("AGORA_APP_CERTIFICATE"),
        "",
        1,
        Role_Publisher,
        REST_AUTH_TOKEN_TTL_SECONDS,
        REST_AUTH_TOKEN_TTL_SECONDS,
    )
    return f'agora token="{token}"'


def _json_or_none(response: requests.Response) -> object:
    try:
        return response.json()
    except ValueError:
        return None


def _safe_upstream_message(payload: object, status: int) -> str:
    """Upstream errors can echo back configuration, secrets included, so they are never
    passed through verbatim."""
    detail = ""
    if isinstance(payload, dict):
        for key in ("reason", "detail", "message"):
            value = payload.get(key)
            if isinstance(value, str) and value:
                detail = value
                break
    lowered = detail.lower()
    if not detail or any(k in lowered for k in ("key", "secret", "token", "authorization")):
        return f"ConvoAI request failed (HTTP {status})"
    return detail


def _mint_identities() -> dict:
    """Mint the channel name and tokens for the three identities.

    The user token carries both RTC and RTM privileges: ConvoAI's data_channel runs over
    RTM, and without it the status messages the engine publishes never arrive.
    AccessToken2 binds the RTM login to the same account, so when the client logs into
    RTM it has to use exactly the same string as its RTC uid.
    """
    app_id = _require("AGORA_APP_ID")
    certificate = _require("AGORA_APP_CERTIFICATE")
    channel = f"spatius-rtc-{secrets.token_hex(10)}"
    ttl = SESSION_TTL_SECONDS
    user_uid = _random_uid("user")
    agent_uid = _random_uid("agent")
    avatar_uid = _random_uid("avatar")

    return {
        "channel": channel,
        "user_uid": user_uid,
        "user_token": RtcTokenBuilder.build_token_with_rtm(
            app_id, certificate, channel, str(user_uid), Role_Publisher, ttl, ttl
        ),
        "agent_uid": agent_uid,
        "agent_token": RtcTokenBuilder.build_token_with_uid(
            app_id, certificate, channel, agent_uid, Role_Publisher, ttl, ttl
        ),
        "avatar_uid": avatar_uid,
        "avatar_token": RtcTokenBuilder.build_token_with_uid(
            app_id, certificate, channel, avatar_uid, Role_Publisher, ttl, ttl
        ),
    }


def missing_keys() -> list[str]:
    """Which Agora settings are still unset. The Spatius ones are checked by the
    caller, since both transports need them."""
    required = ("AGORA_APP_ID", "AGORA_APP_CERTIFICATE", "AGORA_PIPELINE_ID")
    return [k for k in required if not (os.getenv(k) or "").strip()]


def start_agent(avatar_id: str = "", lang: str = "en") -> AgoraSession:
    """Start a ConvoAI agent and return everything the client needs to join.

    **Billing starts the moment this is called** — the client must call `stop_agent`
    when it leaves.
    """
    app_id = _require("AGORA_APP_ID")
    spatius_app_id = _require("SPATIUS_APP_ID")
    region = (os.getenv("SPATIUS_REGION") or "").strip() or "cn-beijing"
    avatar = (avatar_id or os.getenv("SPATIUS_AVATAR_ID") or DEFAULT_AVATAR_ID).strip()
    pipeline_id = _require("AGORA_PIPELINE_ID")
    ids = _mint_identities()

    properties: dict = {
        "channel": ids["channel"],
        "token": ids["agent_token"],
        "agent_rtc_uid": str(ids["agent_uid"]),
        "remote_rtc_uids": [str(ids["user_uid"])],
        "idle_timeout": IDLE_TIMEOUT_SECONDS,
        "advanced_features": {"enable_rtm": True},
        # The avatar is not configured in the console, so it goes here.
        "avatar": {
            "enable": True,
            "vendor": "spatius",
            "params": {
                "spatius_api_key": _require("SPATIUS_API_KEY"),
                "spatius_app_id": spatius_app_id,
                "spatius_avatar_id": avatar,
                "agora_uid": str(ids["avatar_uid"]),
                "agora_token": ids["avatar_token"],
                "region": region,
                "sample_rate": _avatar_sample_rate(),
                "session_expire_minutes": 30,
            },
        },
        # Let the user interrupt the avatar at any point.
        "turn_detection": {"interrupt_mode": "interrupt"},
        "parameters": {"data_channel": "rtm", "enable_error_message": True},
        # ASR / LLM / TTS all come from the configuration published in the console — not
        # one of them is sent from here. The persona is the exception: the console holds
        # the agent's base prompt, but the language follows the client's own setting,
        # which only the client knows. In pipeline mode `llm` is an optional override,
        # so we send system_messages alone and leave the rest.
        "llm": {"system_messages": [{"role": "system", "content": _prompt(lang)}]},
    }

    # Recognition language follows the UI, so switching to English makes the avatar
    # understand English rather than transcribing it against a Chinese model.
    #
    # The whole block has to be sent, resource_id included. That id pins one credential
    # in the Agora console, and a credential only serves the language it was created
    # for: sending "en" while pointing at the Chinese credential leaves English
    # unrecognised, and leaving the id out does not fall back to a matching one — it
    # fails the same way. So there is one id per language, both hard-coded here.
    #
    # Which also means these ids belong to the console this demo was built against.
    # Anyone running it against their own agent has to replace them — see the README.
    # A mismatch is silent: speech comes back as "Yeah." and "Hello?", or as empty text
    # with the timings intact, and nothing reports an error.
    asr_language = "en" if lang == "en" else "zh"
    properties["asr"] = {
        "vendor": ASR_VENDOR,
        "language": asr_language,
        "model": ASR_MODEL,
        "params": {
            "language": asr_language,
            "model": ASR_MODEL,
            "resource_id": ASR_RESOURCE_EN if lang == "en" else ASR_RESOURCE_ZH,
            "keyterm": "",
        },
    }

    response = requests.post(
        f"{_base_url()}/api/conversational-ai-agent/v2/projects/{app_id}/join",
        headers={"Authorization": _auth_header(), "Content-Type": "application/json"},
        json={"name": ids["channel"], "pipeline_id": pipeline_id, "properties": properties},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    payload = _json_or_none(response)
    if not response.ok:
        raise RuntimeError(_safe_upstream_message(payload, response.status_code))

    agent_id = payload.get("agent_id") if isinstance(payload, dict) else None
    if not isinstance(agent_id, str) or not agent_id:
        raise RuntimeError("ConvoAI returned no agent id")

    return AgoraSession(
        agent_id=agent_id,
        app_id=app_id,
        channel_name=ids["channel"],
        token=ids["user_token"],
        uid=ids["user_uid"],
        avatar_id=avatar,
        spatius_app_id=spatius_app_id,
        spatius_region=region,
        agent_uid=ids["agent_uid"],
    )


def _prompt(lang: str) -> str:
    return PROMPTS.get("en" if lang == "en" else "zh", PROMPTS["en"])


def _agent_url(agent_id: str, action: str) -> str:
    app_id = _require("AGORA_APP_ID")
    return (
        f"{_base_url()}/api/conversational-ai-agent/v2"
        f"/projects/{app_id}/agents/{agent_id}/{action}"
    )


def stop_agent(agent_id: str) -> None:
    """Stop the agent. **Must be called when the session ends** — an agent bills
    continuously from the moment it starts."""
    response = requests.post(
        _agent_url(agent_id, "leave"),
        headers={"Authorization": _auth_header()},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    # Stopping often runs on the page-unload path where there is no retry, and an agent
    # that has already exited is not a failure.
    if response.ok or response.status_code == 404:
        return
    raise RuntimeError(_safe_upstream_message(_json_or_none(response), response.status_code))
