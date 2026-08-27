# Backend Mode Next.js Iframe Content

This Vite React app is the iframe payload used by the parent Next.js backend-mode demo.

## Run Directly

```bash
pnpm install
pnpm dev
```

Default URL: `http://localhost:5178`

When running through the parent wrapper, start from `../` instead:

```bash
cd ..
pnpm install
pnpm dev
```

The parent Next.js app proxies `/iframe/*` to this Vite app in development and copies the built iframe assets during production builds.

## Backend Dependency

Run the Backend Mode server in parallel:

```bash
cd ../../../../servers/python
cp .env.example .env
uv sync
uv run uvicorn app.main:app --host 0.0.0.0 --port 8765
```

The client connects to `ws://localhost:8765/ws/agent` by default. Override with `VITE_BACKEND_MODE_WS_URL` when using a different backend URL.

## Project Structure

```text
iframe-content/
├── index.html
├── package.json
├── vite.config.ts
└── src/
    ├── App.tsx
    ├── main.tsx
    ├── components/
    ├── hooks/
    └── views/
```
