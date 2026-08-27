# Backend Mode — Web Clients

These Web clients consume the encoded audio + motion stream produced by the Backend Mode Python backend. They are not started in isolation — start the whole stack with the parent `start.sh`.

## Quick start

From the Backend Mode root:

```bash
cd ../..
./start.sh
```

`start.sh` starts the Python backend at `http://localhost:8765` and launches the default React Web client. Open the client URL printed in the terminal, click **Initialize Avatar**, then use text or microphone input.

Use `./start.sh --no-frontend` if you only want the backend running (for iOS, Android, or Flutter clients).

## Variants

Pick the framework you want to run. Each subdirectory has its own README with framework-specific notes:

- [`react/`](./react) — React + Vite (default in `start.sh`)
- [`vue/`](./vue) — Vue 3 + Vite
- [`vanilla/`](./vanilla) — Vanilla JavaScript + Vite
- [`nextjs-direct/`](./nextjs-direct) — Next.js, avatar canvas mounted directly
- [`nextjs-iframe/`](./nextjs-iframe) — Next.js, avatar wrapped in an iframe

All variants point at the same backend (`http://localhost:8765`) and exercise the same Backend Mode flow: backend owns ASR / LLM / TTS / Server SDK, client receives encoded audio and motion messages and renders the avatar via `yieldAudioData()` / `yieldFramesData()`.

## References

- [Backend Mode integration guide](https://docs.spatius.ai/backend-mode/overview)
- [Client SDK role in Backend Mode](https://docs.spatius.ai/backend-mode/client-sdk)
