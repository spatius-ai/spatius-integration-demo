from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

def _default_console_endpoint(region: str) -> str:
    return f"https://console.{region}.spatius.ai/v1/console"


def _default_ingress_endpoint(region: str) -> str:
    return f"wss://api.{region}.spatius.ai/v2/driveningress"


@dataclass(frozen=True)
class Settings:
    # Server
    server_host: str
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

    # Realtime scene. The conversation runs through a LiveKit agent, and its models
    # are routed by LiveKit Inference — so LiveKit's three credentials replace an
    # account with each of ASR, LLM and TTS.
    livekit_url: str
    livekit_api_key: str
    livekit_api_secret: str
    stt_model: str
    llm_model: str
    tts_model: str
    tts_voice: str
    llm_system_prompt: str

    # Pre-recorded scene: the clip this server sends when asked.
    sample_audio_file: str

    @property
    def public_avatar_config(self) -> dict[str, object]:
        return {
            "appId": self.avatar_app_id,
            "avatarId": self.avatar_id,
            "region": self.public_region,
            "outputSampleRate": self.avatar_output_sample_rate,
            "inputSampleRate": self.user_input_sample_rate,
        }


def _split_origins(raw: str | None) -> list[str]:
    """Where a browser may call this server from.

    Every demo client's dev port, since any of them may be the one running: Direct
    Mode owns 5170-5179 and 3000-3001, Backend Mode 5180-5189 and 3010-3011, RTC
    Mode 5190-5199 and 3020-3021. The three are meant to be run at the same time,
    which is why the blocks do not overlap.

    A missing origin here is not an error the browser reports usefully — the fetch
    simply fails, the configuration page stays blank, and nothing says why.
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


# What a client may read and write, mirroring Direct Mode's config page. Secrets are
# included: this server runs on the user's own machine, and being able to fill
# everything in on screen — from a phone, which has no .env to edit — matters more
# than keeping them out of an API that has no auth anyway.
EDITABLE_KEYS = [
    "SPATIUS_APP_ID",
    "SPATIUS_API_KEY",
    "SPATIUS_AVATAR_ID",
    "SPATIUS_REGION",
    "LIVEKIT_URL",
    "LIVEKIT_API_KEY",
    "LIVEKIT_API_SECRET",
]

ENV_PATH = Path(__file__).resolve().parents[1] / ".env"

PLACEHOLDER_VALUES = {
    "your_spatius_api_key",
    "your_spatius_app_id",
    "your_api_key",
    "your_app_id",
    "replace_me",
}


def is_placeholder(value: str | None) -> bool:
    return bool(value) and value.strip().lower() in PLACEHOLDER_VALUES


def read_env_file() -> dict[str, str]:
    """The keys already in .env. Understands only `KEY=value`, one per line."""
    if not ENV_PATH.exists():
        return {}
    existing: dict[str, str] = {}
    for raw in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        existing[key.strip()] = value.strip()
    return existing


def write_env_file(updates: dict[str, str]) -> list[str]:
    """Save what was filled in on the page, taking effect immediately.

    Rewrites the whole file rather than appending: a repeated key resolves in a way
    that is not obvious, and duplicates eventually produce the "I changed it and
    nothing happened" problem. Keys already in the file that are not on the page —
    ports, model names — are carried over.
    """
    wanted = {k: str(v).strip() for k, v in updates.items() if k in EDITABLE_KEYS}
    # A blank field means "leave what is saved", not "erase it".
    wanted = {k: v for k, v in wanted.items() if v}

    merged = read_env_file()
    merged.update(wanted)

    lines = [
        "# Written by the demo's config page. You can also edit this file directly.",
        "",
    ]
    lines += [f"{key}={value}" for key, value in merged.items()]
    ENV_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")

    for key, value in wanted.items():
        os.environ[key] = value
    # Settings are built once and cached; without this the save writes the file but
    # the running server keeps using what it read at startup.
    get_settings.cache_clear()
    return sorted(wanted)


# Shown next to the clip list so nobody reads the bundled files as the limit of what
# Backend Mode accepts.
SAMPLE_AUDIO_HINT = (
    "These clips are bundled samples, not a limitation. The server sends any PCM16 "
    "audio at the configured sample rate — a TTS service, your own pipeline, or a "
    "file like these. The demo ships files so it runs without extra setup."
)


def sample_clips(settings: Settings) -> list[dict[str, str]]:
    """The clips the pre-recorded scene can play, read from the assets directory.

    Listed from disk rather than hard-coded so dropping a .pcm file in is enough to
    make it playable — there is no second place to register it.
    """
    directory = (
        Path(settings.sample_audio_file).expanduser()
        if settings.sample_audio_file
        else Path(__file__).resolve().parents[1] / "assets"
    )
    if not directory.is_dir():
        return []
    return [
        # The stem is what a reader sees; the file name is what comes back on play.
        {"name": path.stem, "clip": path.name}
        for path in sorted(directory.glob("*.pcm"))
    ]


def saved_config() -> dict[str, str]:
    """What is stored, for the config page to start from. Placeholders read as blank
    so the form does not look filled in with `your_spatius_api_key`."""
    return {
        key: ("" if is_placeholder(os.getenv(key, "")) else os.getenv(key, "").strip())
        for key in EDITABLE_KEYS
    }


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    region = os.getenv("SPATIUS_REGION", "us-west").strip() or "us-west"
    return Settings(
        server_host=os.getenv("SERVER_HOST", "127.0.0.1"),
        server_port=int(os.getenv("SERVER_PORT", "8765")),
        cors_allow_origins=_split_origins(os.getenv("CORS_ALLOW_ORIGINS")),

        public_region=region,
        avatar_app_id=os.getenv("SPATIUS_APP_ID", "").strip(),
        avatar_api_key=os.getenv("SPATIUS_API_KEY", "").strip(),
        avatar_id=os.getenv("SPATIUS_AVATAR_ID", "").strip(),
        avatar_console_endpoint=(
            os.getenv("SPATIUS_CONSOLE_ENDPOINT", "").strip()
            or _default_console_endpoint(region)
        ),
        avatar_ingress_endpoint=(
            os.getenv("SPATIUS_INGRESS_ENDPOINT", "").strip()
            or _default_ingress_endpoint(region)
        ),
        avatar_output_sample_rate=int(os.getenv("AVATAR_OUTPUT_SAMPLE_RATE", "16000")),
        user_input_sample_rate=int(os.getenv("USER_INPUT_SAMPLE_RATE", "16000")),

        livekit_url=os.getenv("LIVEKIT_URL", "").strip(),
        livekit_api_key=os.getenv("LIVEKIT_API_KEY", "").strip(),
        livekit_api_secret=os.getenv("LIVEKIT_API_SECRET", "").strip(),
        stt_model=os.getenv("STT_MODEL", "deepgram/nova-3").strip(),
        llm_model=os.getenv("LLM_MODEL", "openai/gpt-4.1-mini").strip(),
        tts_model=os.getenv("TTS_MODEL", "cartesia/sonic-2").strip(),
        tts_voice=os.getenv("TTS_VOICE", "").strip(),
        llm_system_prompt=os.getenv("LLM_SYSTEM_PROMPT", "").strip(),

        sample_audio_file=os.getenv("SAMPLE_AUDIO_FILE", "").strip(),
    )


def validate_settings(settings: Settings) -> list[str]:
    """What the server cannot run at all without — the Spatius credentials.

    LiveKit's are not here: the pre-recorded scene never touches the agent, so a
    server configured only for that one is not broken. Use `missing_for_scene`
    for the per-scene answer.
    """
    required = {
        "SPATIUS_APP_ID": settings.avatar_app_id,
        "SPATIUS_API_KEY": settings.avatar_api_key,
        "SPATIUS_AVATAR_ID": settings.avatar_id,
    }
    return [name for name, value in required.items() if not value]


def missing_for_scene(settings: Settings) -> dict[str, list[str]]:
    """Which credentials each scene is still waiting on.

    Reported per scene so a client can grey out only what cannot run and name the
    key, rather than failing at the click.
    """
    spatius = validate_settings(settings)
    livekit = {
        "LIVEKIT_URL": settings.livekit_url,
        "LIVEKIT_API_KEY": settings.livekit_api_key,
        "LIVEKIT_API_SECRET": settings.livekit_api_secret,
    }
    return {
        "sample": spatius,
        "realtime": spatius + [name for name, value in livekit.items() if not value],
    }
