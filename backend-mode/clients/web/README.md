# Backend Mode — Web Clients

These Web clients consume the encoded audio + motion stream produced by the Backend Mode Python backend. They are not started in isolation — start the whole stack with the parent `start.sh`.

## Quick start

From the Backend Mode root:

```bash
cd ../..
./start.sh
```

`start.sh` starts the Python backend at `http://localhost:8765` and launches the default React Web client on `http://localhost:5180`. The client opens straight on the playground: it fetches the App ID, region, avatar id and sample rate from the backend's `/api/config` and initializes the SDK for you. Pick a character if you want a different one, then use text or microphone input.

There is nothing to configure in the browser — every credential and every conversation option (language, region, voice) lives in the server's `.env`.

Use `./start.sh --no-frontend` if you only want the backend running (for iOS, Android, or Flutter clients).

## Variants

Pick the framework you want to run. Each subdirectory has its own README with framework-specific notes:

| Variant | Stack | Dev URL |
|---|---|---|
| [`react/`](./react) | React + Vite (default in `start.sh`) | http://localhost:5180 |
| [`vue/`](./vue) | Vue 3 + Vite | http://localhost:5181 |
| [`vanilla/`](./vanilla) | Vanilla JavaScript + Vite | http://localhost:5182 |
| [`nextjs-direct/`](./nextjs-direct) | Next.js, avatar canvas mounted directly | http://localhost:3010 |
| [`nextjs-iframe/`](./nextjs-iframe) | Next.js, avatar wrapped in an iframe | http://localhost:3011 |

To run one on its own:

```bash
cd react            # or vue/ vanilla/ nextjs-direct/ nextjs-iframe/
cp .env.example .env   # only if the backend is not at localhost:8765
pnpm install
pnpm dev
```

The backend address is the one thing a client cannot ask the backend for, so it comes
from an env var: `VITE_BACKEND_MODE_WS_URL` (Vite variants) or
`NEXT_PUBLIC_BACKEND_MODE_WS_URL` (`nextjs-direct`), each defaulting to
`ws://localhost:8765/ws/agent`.

All variants point at the same backend (`http://localhost:8765`) and exercise the same Backend Mode flow: backend owns ASR / LLM / TTS / Server SDK, client receives encoded audio and motion messages and renders the avatar via `yieldAudioData()` / `yieldFramesData()`.

## References

- [Backend Mode integration guide](https://docs.spatius.ai/backend-mode/server-sdk)
- [Client SDK role in Backend Mode](https://docs.spatius.ai/backend-mode/client-sdk)
