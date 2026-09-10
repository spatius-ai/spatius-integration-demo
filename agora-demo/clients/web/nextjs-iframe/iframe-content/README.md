# Agora Demo — Next.js iframe content

This Vite + React app is the iframe payload for the parent Next.js demo. It is the
same room as the standalone React client; isolating it in its own document is what
keeps the SDK out of Next's server pass entirely, rather than deferring it with
`next/dynamic` the way [`../../nextjs-direct`](../../nextjs-direct) has to.

## Run it

Normally you do not: start the parent instead, which runs this and Next together.

```bash
cd ..
pnpm install:all
pnpm dev            # Next on 3021, this on 5198
```

To run this app on its own:

```bash
pnpm install
pnpm dev            # http://localhost:5198
```

Either way the [demo server](../../../../servers/python/README.md) has to be running
first — the page asks it for its configuration on load, and shows a retry if it
cannot.

The parent proxies `/iframe/*` here in development, and copies the built assets into
`public/iframe` during a production build.

## Structure

```text
iframe-content/
├── index.html
├── vite.config.ts
└── src/
    ├── App.tsx          boot: read the server's config, then the room
    ├── main.tsx
    ├── views/Room.tsx   characters, avatar, microphone
    ├── components/
    ├── hooks/
    └── utils/rtcSession.ts
```
