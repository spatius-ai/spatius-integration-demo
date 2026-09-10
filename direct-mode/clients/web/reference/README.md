# Direct Mode — Web reference clients

The same client, written five times. They differ only in how they draw a button:
the flow, the backend calls and the SDK lifecycle are identical, so pick whichever
matches your stack and read that one.

| Framework | Directory | Dev URL |
| --- | --- | --- |
| React | [`react/`](./react) | http://localhost:5173 |
| Vue | [`vue/`](./vue) | http://localhost:5174 |
| Vanilla TS | [`vanilla/`](./vanilla) | http://localhost:5175 |
| Next.js (direct import) | [`nextjs-direct/`](./nextjs-direct) | http://localhost:3000 |
| Next.js (iframe) | [`nextjs-iframe/`](./nextjs-iframe) | http://localhost:3001 |

Logic shared by all five lives in [`../shared/src`](../shared/src) — the config
fetch and the session token exchange.

## Run

The server holds the credentials and mints Session Tokens, so it starts first:

```bash
cd ../../../servers/python
cp .env.example .env    # fill SPATIUS_API_KEY, SPATIUS_APP_ID and the LiveKit keys
uv sync
uv run app.py
```

It refuses to start while a required key is empty, naming the ones that are.

Then any one client, in a second terminal:

```bash
cd react        # or vue, vanilla, nextjs-direct, nextjs-iframe
pnpm install
pnpm dev
```

It opens straight on the playground: pick a character, press **Start**, then tap
the microphone and talk. There is nothing to configure in the browser — every
credential, the region, the avatar, the language and the voice are the server's
`.env`, and the client fetches what it needs from `GET /api/config` at launch.

The one client-side setting is where that server lives. By default it is the
page's own host on port 8090, which is right when both run on the same machine;
set `VITE_DIRECT_MODE_URL` (Vite clients) or `NEXT_PUBLIC_DIRECT_MODE_URL`
(Next.js clients) when it is elsewhere — a LAN address, say, so a phone can reach
your laptop. Each client ships a `.env.example` documenting its variable — for
`nextjs-iframe` that is `iframe-content/.env.example`, since the SDK runs there.

## What drives the avatar

The browser captures microphone PCM and sends it to the server, which runs ASR,
LLM and TTS and streams the assistant's reply back as PCM over the same
WebSocket. The client hands that to `controller.send()` and keeps the Motion
Server connection itself — which is what makes it Direct Mode. There is no
LiveKit room in the path.

## The two Next.js demos

They exist to show the two ways of getting a WebGL SDK past server rendering:

- **`nextjs-direct`** imports the SDK into the app bundle and defers the whole
  client tree with `next/dynamic({ ssr: false })`. `'use client'` alone is not
  enough — a client component is still rendered once on the server to produce the
  initial HTML, and the SDK reaches for `location` and WebGL as it initialises.
- **`nextjs-iframe`** puts the SDK in a separate document instead, served under
  `/iframe/`, so it never enters the server pass at all.

## About the audio

The microphone is one source, not a constraint. `send()` takes any PCM16 audio at
the configured sample rate — live capture, a TTS stream, a file read off disk, or
audio from your own pipeline all go through the same call. Swap the byte source
and the rest of the integration is unchanged.

## References

- [Direct Mode client guide](https://docs.spatius.ai/direct-mode/client)
- [Web SDK reference](https://docs.spatius.ai/sdk-reference/web-sdk/reference)
- [Direct Mode overview](../../../README.md)
