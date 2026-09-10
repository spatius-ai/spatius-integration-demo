from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from functools import lru_cache

from dotenv import load_dotenv

load_dotenv()

AUTO_REGION = "auto"


def _default_console_endpoint(region: str) -> str:
    return f"https://console.{region}.spatius.ai/v1/console"


def _default_ingress_endpoint(region: str) -> str:
    return f"wss://api.{region}.spatius.ai/v2/driveningress"


@dataclass(frozen=True)
class Settings:
    # Server
    server_port: int
    cors_allow_origins: list[str]

    # Spatius
    public_region: str
    avatar_app_id: str
    avatar_api_key: str
    avatar_id: str
    avatar_console_endpoint: str
    avatar_ingress_endpoint: str
    avatar_output_sample_rate: int
    user_input_sample_rate: int

    # The conversation runs through a LiveKit agent, and its models are routed by
    # LiveKit Inference — so LiveKit's three credentials replace an account with
    # each of ASR, LLM and TTS.
    livekit_url: str
    livekit_api_key: str
    livekit_api_secret: str
    stt_model: str
    llm_model: str
    tts_model: str
    tts_voice: str
    llm_system_prompt: str
    conversation_language: str

    @property
    def public_avatar_config(self) -> dict[str, object]:
        """What a client needs to boot: never a credential.

        Clients hold none at all — the server owns the Motion Server connection —
        so this is the whole of what `/api/config` answers.
        """
        return {
            "appId": self.avatar_app_id,
            "avatarId": self.avatar_id,
            "region": self.public_region,
            "inputSampleRate": self.user_input_sample_rate,
        }


def _split_origins(raw: str | None) -> list[str]:
    """Where a browser may call this server from.

    Every demo client's dev port, since any of them may be the one running: Direct
    Mode owns 5170-5179 and 3000-3001, Backend Mode 5180-5189 and 3010-3011, RTC
    Mode 5190-5199 and 3020-3021. The three are meant to be run at the same time,
    which is why the blocks do not overlap.

    A missing origin here is not an error the browser reports usefully — the fetch
    simply fails, the page stays blank, and nothing says why.
    """
    if not raw:
        ports = [str(p) for p in range(5170, 5200)]
        ports += ["3000", "3001", "3010", "3011", "3020", "3021"]
        return [
            origin
            for port in ports
            for origin in (f"http://127.0.0.1:{port}", f"http://localhost:{port}")
        ]
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


# What a freshly copied .env.example still says. Treated as unset rather than as a
# value, or the server starts happily and fails later with an authentication error
# that points at Spatius rather than at the file that was never filled in.
PLACEHOLDER_VALUES = {
    "your_spatius_api_key",
    "your_spatius_app_id",
    "your_api_key",
    "your_app_id",
    "replace_me",
    "wss://your-project.livekit.cloud",
}


def _setting(name: str, default: str = "") -> str:
    value = os.getenv(name, default).strip()
    return "" if value.lower() in PLACEHOLDER_VALUES else value


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    # Blank means automatic selection: clients get `auto` and let the SDK pick the
    # closest region, and the server's own session leaves the endpoints blank so the
    # Python SDK resolves them the same way. A pinned region composes them directly.
    region = _setting("SPATIUS_REGION") or AUTO_REGION
    pinned = region != AUTO_REGION
    language = _setting("CONVERSATION_LANGUAGE", "en").lower()
    return Settings(
        server_port=int(os.getenv("SERVER_PORT", "8765")),
        cors_allow_origins=_split_origins(os.getenv("CORS_ALLOW_ORIGINS")),

        public_region=region,
        avatar_app_id=_setting("SPATIUS_APP_ID"),
        avatar_api_key=_setting("SPATIUS_API_KEY"),
        avatar_id=_setting("SPATIUS_AVATAR_ID"),
        avatar_console_endpoint=(
            _setting("SPATIUS_CONSOLE_ENDPOINT")
            or (_default_console_endpoint(region) if pinned else "")
        ),
        avatar_ingress_endpoint=(
            _setting("SPATIUS_INGRESS_ENDPOINT")
            or (_default_ingress_endpoint(region) if pinned else "")
        ),
        avatar_output_sample_rate=int(os.getenv("AVATAR_OUTPUT_SAMPLE_RATE", "16000")),
        user_input_sample_rate=int(os.getenv("USER_INPUT_SAMPLE_RATE", "16000")),

        livekit_url=_setting("LIVEKIT_URL"),
        livekit_api_key=_setting("LIVEKIT_API_KEY"),
        livekit_api_secret=_setting("LIVEKIT_API_SECRET"),
        stt_model=_setting("STT_MODEL", "deepgram/nova-3"),
        llm_model=_setting("LLM_MODEL", "openai/gpt-4.1-mini"),
        tts_model=_setting("TTS_MODEL", "cartesia/sonic-2"),
        tts_voice=_setting("TTS_VOICE"),
        llm_system_prompt=os.getenv("LLM_SYSTEM_PROMPT", "").strip(),
        conversation_language="zh" if language.startswith("zh") else "en",
    )


# Every key the server needs to run, and where to get it. One flat list: there is one
# scene, and it needs all of them.
REQUIRED_KEYS: list[tuple[str, str]] = [
    ("SPATIUS_APP_ID", "https://app.spatius.ai/apps"),
    ("SPATIUS_API_KEY", "https://app.spatius.ai/apps"),
    ("SPATIUS_AVATAR_ID", "https://app.spatius.ai/avatars/library"),
    ("LIVEKIT_URL", "https://cloud.livekit.io"),
    ("LIVEKIT_API_KEY", "https://cloud.livekit.io"),
    ("LIVEKIT_API_SECRET", "https://cloud.livekit.io"),
]


def missing_keys(settings: Settings) -> list[str]:
    """Which required keys are still blank or still a placeholder."""
    present = {
        "SPATIUS_APP_ID": settings.avatar_app_id,
        "SPATIUS_API_KEY": settings.avatar_api_key,
        "SPATIUS_AVATAR_ID": settings.avatar_id,
        "LIVEKIT_URL": settings.livekit_url,
        "LIVEKIT_API_KEY": settings.livekit_api_key,
        "LIVEKIT_API_SECRET": settings.livekit_api_secret,
    }
    return [name for name, _ in REQUIRED_KEYS if not present[name]]


def require_complete_settings() -> Settings:
    """Read the configuration, or stop.

    Checked at import rather than at the first request: a server that starts without
    credentials looks healthy and fails at the moment someone is watching an avatar,
    with an error that reaches them as a toast rather than as the line in `.env` that
    was never filled in.
    """
    settings = get_settings()
    missing = missing_keys(settings)
    if not missing:
        return settings

    hints = dict(REQUIRED_KEYS)
    print("\n  Backend Mode server cannot start — .env is incomplete.\n", file=sys.stderr)
    for name in missing:
        print(f"    {name:<22} missing   {hints[name]}", file=sys.stderr)
    print(
        "\n  Fill these in servers/python/.env (copy .env.example if you have not "
        "yet), then start again.\n",
        file=sys.stderr,
    )
    raise SystemExit(1)
