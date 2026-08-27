# Direct Mode client core

Everything the five framework clients share: the backend calls, the SDK lifecycle, and
the two scenes. Framework-agnostic TypeScript — the clients differ only in how they
draw a button, so none of this is worth writing five times.

| File | What it holds |
|---|---|
| `backend.ts` | config, session tokens, the sample clip |
| `avatar.ts` | SDK init → avatar load → Motion Server connection |
| `audio.ts` | PCM16 helpers and microphone capture |
| `scenes.ts` | the two scenes: `playSampleAudio()` and `RealtimeScene` |

Consumed by source rather than built: each client aliases `@direct-core` at its own
`vite.config`, so there is no build step to run before `pnpm dev`.
