# LiveKit Room example — Token Server (Python)

## Purpose

Issues LiveKit access tokens and creates the room if missing. Paired with the Web client to validate the RTC Adapter's LiveKit wiring. No agent dispatch; no audio/motion producer in this sample.

## Run

```bash
cp .env.example .env
uv sync
uv run token_server.py
```

Default: `http://localhost:8081`

## API

- `GET /health`
- `POST /token`

## Reference

- LiveKit cloud: https://cloud.livekit.io/
