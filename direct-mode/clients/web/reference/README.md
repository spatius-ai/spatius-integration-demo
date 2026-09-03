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

Logic shared by all five lives in [`../shared/src`](../shared/src) — the backend
calls, the session token exchange and the scene helpers.

## Run

The server holds the credentials and mints Session Tokens, so it starts first:

```bash
cd ../../../servers/python
cp .env.example .env    # fill SPATIUS_API_KEY and SPATIUS_APP_ID
uv run app.py
```

Then any one client, in a second terminal:

```bash
cd react        # or vue, vanilla, nextjs-direct, nextjs-iframe
pnpm install
pnpm dev
```

There is no client-side `.env`. Direct Mode keeps the API Key on the server, and
anything left blank there can be filled in on the configuration page instead —
which is what makes the demo reachable from a phone on the same network.

## The two scenes

Both drive the avatar through the same `controller.send()`; they differ only in
where the audio comes from.

- **Pre-recorded audio** streams a bundled PCM clip. Needs only the two Spatius
  values.
- **Realtime conversation** captures the microphone and runs a voice agent on the
  server, so it also needs the LiveKit section of the server's `.env`. LiveKit is
  used for Inference only, not for a room.

## The two Next.js demos

They exist to show the two ways of getting a WebGL SDK past server rendering:

- **`nextjs-direct`** imports the SDK into the app bundle and defers the whole
  client tree with `next/dynamic({ ssr: false })`. `'use client'` alone is not
  enough — a client component is still rendered once on the server to produce the
  initial HTML, and the SDK reaches for `location` and WebGL as it initialises.
- **`nextjs-iframe`** puts the SDK in a separate document instead, served under
  `/iframe/`, so it never enters the server pass at all.

## About the bundled audio

The clips shipped with these demos are samples, not a constraint. `send()` takes
any PCM16 audio at the configured sample rate — live microphone capture, a TTS
stream, or audio from your own pipeline all go through the same call. Files are
bundled so the demo runs with nothing but an App ID and an API Key.

## References

- [Direct Mode client guide](https://docs.spatius.ai/direct-mode/client)
- [Web SDK reference](https://docs.spatius.ai/sdk-reference/web-sdk/reference)
- [Direct Mode overview](../../../README.md)
