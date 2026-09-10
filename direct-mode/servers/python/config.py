"""Configuration shared by the token endpoint and the realtime agent.

Everything lives in `.env` here rather than in each client: Direct Mode clients hold
no credentials at all, so the App ID, the avatar and the region have to reach them
from somewhere, and `GET /api/config` is that somewhere. The conversation language,
the models and the voice never leave this file — the client has no say in them.
"""

from __future__ import annotations

import os
import sys

from dotenv import find_dotenv, load_dotenv

ENV_FILE_PATH = find_dotenv(filename=".env", usecwd=True)
ENV_FILE_MISSING = ENV_FILE_PATH == ""
if not ENV_FILE_MISSING:
    load_dotenv(ENV_FILE_PATH)

# A public sample avatar any account can load, so the demo runs before an avatar of
# your own exists. Kept in sync with characters.ts in the web clients.
DEFAULT_AVATAR_ID = "aed008e4-8ddf-41aa-b5b2-5d7321dd4165"

# What the clients send and expect back. PCM16 mono throughout: the SDK is configured
# for it on the client side, and the agent's STT and TTS are pinned to it below, so
# nothing in this path has to resample.
SAMPLE_RATE = 16_000
NUM_CHANNELS = 1

# The values a fresh .env.example carries. Treated as missing rather than as
# credentials, so the error says "fill this in" instead of failing against the API.
PLACEHOLDER_VALUES = {
    "your_spatius_api_key",
    "your_spatius_app_id",
    "wss://your-project.livekit.cloud",
}

# Everything a conversation needs. Checked once at startup rather than per request:
# a demo that boots and then fails at the first click is harder to place than one
# that refuses to start and says which line of `.env` is empty.
REQUIRED_KEYS = [
    "SPATIUS_API_KEY",
    "SPATIUS_APP_ID",
    "LIVEKIT_URL",
    "LIVEKIT_API_KEY",
    "LIVEKIT_API_SECRET",
]

KEY_HINTS = {
    "SPATIUS_API_KEY": "https://app.spatius.ai/apps",
    "SPATIUS_APP_ID": "https://app.spatius.ai/apps",
    "LIVEKIT_URL": "https://cloud.livekit.io",
    "LIVEKIT_API_KEY": "https://cloud.livekit.io",
    "LIVEKIT_API_SECRET": "https://cloud.livekit.io — shown only once, at creation",
}


def env(key: str, default: str = "") -> str:
    return (os.getenv(key, default) or "").strip()


def is_unset(value: str) -> bool:
    """Empty, or still carrying the value `.env.example` ships with."""
    return not value or value.lower() in PLACEHOLDER_VALUES


def require_env() -> None:
    """Refuse to start against an unfilled `.env`.

    Every client boots by fetching `/api/config`, so a server that comes up without
    credentials only moves the failure to a place with less context. Named keys and a
    link each is all this can usefully say, and it is enough.
    """
    missing = [key for key in REQUIRED_KEYS if is_unset(env(key))]
    if not missing:
        return

    print("\n  Cannot start: .env is incomplete.\n", file=sys.stderr)
    if ENV_FILE_MISSING:
        print("  No .env found. Copy .env.example to .env first.\n", file=sys.stderr)
    for key in missing:
        print(f"    {key:<22} {KEY_HINTS.get(key, '')}", file=sys.stderr)
    print("", file=sys.stderr)
    raise SystemExit(1)


AUTO_REGION = "auto"
FALLBACK_REGION = "us-west"


def spatius_region() -> str:
    """The region handed to clients. `auto` (the default when `SPATIUS_REGION` is
    blank) lets the client SDK pick the closest serving region itself."""
    return env("SPATIUS_REGION") or AUTO_REGION


def console_endpoint() -> str:
    """Where session tokens are minted. Composed from the region unless pinned; with
    `auto` there is no region to compose from, so the fallback region is used. Any
    region will do: a session token is not tied to the region that minted it."""
    region = spatius_region()
    if region == AUTO_REGION:
        region = FALLBACK_REGION
    return (
        env("SPATIUS_CONSOLE_ENDPOINT")
        or f"https://console.{region}.spatius.ai/v1/console"
    ).rstrip("/")


def app_id() -> str:
    return env("SPATIUS_APP_ID")


def avatar_id() -> str:
    return env("SPATIUS_AVATAR_ID") or DEFAULT_AVATAR_ID


def conversation_language() -> str:
    """The language the agent listens and replies in: `en` or `zh`.

    Server-side because it is not a per-session choice: recognition, synthesis and
    the persona are all fixed when the agent session is built, so switching it means
    a new session — which is a restart, not a toggle.
    """
    value = env("CONVERSATION_LANGUAGE", "en").lower()
    return "zh" if value.startswith("zh") else "en"
