# LiveKit Demo — iframe content

This Vite + React app is the iframe payload for the parent Next.js demo. It is the
same app as [`../../react`](../../react), isolated in its own document: the SDK
reaches for `location` and WebGL as it loads, and a separate document keeps it out of
Next's server pass entirely. The sibling [`../../nextjs-direct`](../../nextjs-direct)
solves that with `next/dynamic` instead.

## Run

Normally you start the parent, which runs this alongside it:

```bash
cd ..
pnpm install:all
pnpm dev            # Next on 3021, this on 5198
```

To run it on its own:

```bash
pnpm install
pnpm dev            # http://localhost:5198
```

Either way the demo server has to be up first — see the
[demo README](../../../../README.md). The app opens on the playground: pick a
character and talk. There is nothing to fill in; every credential and setting lives
in the server's `.env`.

Set `VITE_DEMO_SERVER_URL` in `.env` if the server is not on this machine (see
`.env.example`).

The parent proxies `/iframe/*` here in development, and copies this app's build into
its `public/iframe` for production.

## Layout

```text
iframe-content/
├── index.html
├── vite.config.ts
└── src/
    ├── App.tsx          fetches the server config, initializes the SDK, shows the room
    ├── views/Room.tsx   the playground
    ├── utils/           the RTC session
    ├── components/  data/  hooks/
```
