"""Configuration shared by the token endpoint and the realtime agent.

Everything the clients need lives here rather than in each client's `.env`: Direct
Mode clients hold no credentials at all, so the App ID and avatar id have to reach
them from somewhere, and `GET /api/config` is that somewhere.
"""

from __future__ import annotations

import os
from pathlib import Path

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

# Values a fresh .env.example still carries. Treated as missing rather than as
# credentials, so the error says "fill this in" instead of failing against the API.
PLACEHOLDER_VALUES = {
    "your_spatius_api_key",
    "your_spatius_app_id",
    "your_api_key",
    "your_app_id",
    "replace_me",
}

DOCS_LINKS = {
    "keys": "https://app.spatius.ai/apps",
    "auth": "https://docs.spatius.ai/api-reference/auth",
    "livekit": "https://cloud.livekit.io",
}


def env(key: str, default: str = "") -> str:
    return (os.getenv(key, default) or "").strip()


def is_placeholder(value: str | None) -> bool:
    if not value:
        return False
    return value.strip().lower() in PLACEHOLDER_VALUES


def missing_keys(*keys: str) -> list[str]:
    """Which of these are absent or still a placeholder.

    One helper for both scenes: the sample-audio scene needs only the Spatius pair,
    while the realtime scene needs LiveKit's on top, and each endpoint asks for what
    it actually uses.
    """
    missing: list[str] = []
    for key in keys:
        value = env(key)
        if not value or is_placeholder(value):
            missing.append(key)
    return missing


def spatius_region() -> str:
    return env("SPATIUS_REGION", "us-west") or "us-west"


def console_endpoint() -> str:
    """Where session tokens are minted. Composed from the region unless pinned."""
    return (
        env("SPATIUS_CONSOLE_ENDPOINT")
        or f"https://console.{spatius_region()}.spatius.ai/v1/console"
    ).rstrip("/")


def avatar_id() -> str:
    return env("SPATIUS_AVATAR_ID") or DEFAULT_AVATAR_ID


def sample_audio_path() -> Path:
    """The clip the sample-audio scene plays.

    Bundled with the server rather than fetched, so that scene needs no credentials
    beyond the ones that mint a token — which is the point of it.
    """
    configured = env("SAMPLE_AUDIO_FILE")
    if configured:
        return Path(configured).expanduser()
    return Path(__file__).resolve().parent / "assets" / "sample_voice.pcm"
