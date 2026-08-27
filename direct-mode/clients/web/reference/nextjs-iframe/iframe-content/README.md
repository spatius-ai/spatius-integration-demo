# Direct Mode Next.js Iframe Content

This Vite React app is the iframe payload used by the parent Next.js SDK-mode demo.

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

## Usage

Enter your Spatius App ID and Session Token in the iframe UI, select a region and avatar, then start playback with one of the bundled PCM audio files.

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
    ├── views/
    └── utils/
```
