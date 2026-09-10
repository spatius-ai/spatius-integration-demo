# Direct Mode client core

What the five framework clients share: the two backend calls. Framework-agnostic
TypeScript — the clients differ only in how they draw a button, so this is not worth
writing five times.

| File | What it holds |
|---|---|
| `backend.ts` | `fetchConfig()` and `fetchSessionToken()` |

Consumed by source rather than built, so there is no build step before `pnpm dev`: the
Vite clients alias it as `@direct-core`, and `nextjs-direct` takes it as a `file:`
dependency named `@spatius-demo/direct-mode-core`.

The backend URL comes from `VITE_DIRECT_MODE_URL` (Vite clients) or
`NEXT_PUBLIC_DIRECT_MODE_URL` (Next.js clients), defaulting to the page's own host on
port 8090.
