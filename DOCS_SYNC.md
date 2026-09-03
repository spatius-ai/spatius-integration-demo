# Demo and Docs Sync Guide

This repository and the public docs (`spatius-ai/docs`, published at `https://docs.spatius.ai`) must be updated together. Demo paths should match the user-facing integration paths used in docs.

The docs site exposes exactly four integrations: LiveKit Agents Integration, Agora Convo AI Integration, Direct Mode Integration, and Backend Mode Integration. This repository's `rtc-mode` is not a separate docs entry — it is the demo for the two RTC-based integrations, selected by `TRANSPORT` (`livekit` → LiveKit Agents, `agora` → Agora Convo AI).

Complete scenario quickstarts (`quickstarts/*`) come from `spatius-ai/spatius-scenario-demo`, not from this repository.

## Integration Path Map

| User-facing path | Demo directories | Docs pages to update |
| --- | --- | --- |
| Direct Mode | `direct-mode/clients/*`, `direct-mode/servers/*` | `integrations/overview`, `direct-mode/client`, `resources/demo-projects`, relevant client SDK references under `sdk-reference/*` |
| Backend Mode | `backend-mode/clients/*`, `backend-mode/servers/*` | `integrations/overview`, `backend-mode/server-sdk`, `backend-mode/client-sdk`, `resources/demo-projects`, relevant Server SDK references under `sdk-reference/*` |
| LiveKit Agents Integration | `rtc-mode` (`TRANSPORT=livekit`), `platform-integrations/livekit-agents-demo/livekit-agent-quickstart`, `platform-integrations/livekit-agents-demo/livekit-agents-reference-demo` | `integrations/overview`, `livekit-agents/overview`, `livekit-agents/server`, `livekit-agents/client`, `resources/demo-projects`, `sdk-reference/web-sdk/rtc-adapter` |
| Agora Convo AI Integration | `rtc-mode` (`TRANSPORT=agora`) | `integrations/overview`, `agora-convoai/overview`, `agora-convoai/convo-ai-agent`, `agora-convoai/ten-extension`, `agora-convoai/client`, `resources/demo-projects`, `sdk-reference/web-sdk/rtc-adapter` |

`platform-integrations/livekit-room-demo` is the minimal LiveKit example for `@spatius/avatarkit-rtc` (the RTC Adapter) with `LiveKitProvider`. It validates token issuance, room connection, adapter + provider init, avatar load and render, and mic publishing. Remote audio playback and motion rendering only happen when a producer publishes into the room — this demo has no agent, Server SDK, or Motion Server producer of its own. Keep it aligned with `sdk-reference/web-sdk/rtc-adapter`, `livekit-agents/client`, and `resources/demo-projects`.

## Sync Rules

- If a demo path, run command, required env var, package name, default endpoint, or avatar ID changes, update the matching docs page in `spatius-ai/docs`.
- If a docs guide introduces a new recommended flow, add or update the matching demo README in this repository.
- Every `https://docs.spatius.ai/...` link in this repository must point to a page listed in the docs repo's `docs.json` navigation. Do not rely on `docs.json > redirects` — fix the link here instead.
- Keep the three modes presented as one set. Each has a server that holds the credentials and a client that starts by picking a scene on a configuration page; the modes differ only in who connects to Motion Server — the client (Direct), the server (Backend), or neither, with the avatar itself in the room (RTC).
- Keep the two scenes named consistently across modes: **Sample audio** for the bundled clip, **Realtime conversation** for the microphone path. RTC Mode is realtime only.
- Keep package examples on compatible latest ranges where the package manager supports it:
  - npm: `^1.0.0`
  - Python: `>=1.0.0,<2.0.0` or the current LiveKit-compatible `>=1.5.8,<2.0.0`
  - Android: `1.+`
- Do not commit local lockfiles for demo dependency resolution. Fresh installs should resolve the latest compatible SDK package.
- Keep the bundled PCM sample files served by the servers, not the clients: `direct-mode/servers/python/assets/sample_voice.pcm` for the single Direct Mode clip, and `backend-mode/servers/python/assets/` for the clips Backend Mode lists by scanning that directory.

## Verification Checklist

Run these before publishing related changes:

```bash
# This repo: every docs link must resolve to a page in the docs navigation
grep -rno "docs\.spatius\.ai/[^ )\`\"'>#]*" --include='*.md' --include='*.example' --include='*.py' --include='*.ts' --include='*.swift' --include='*.kt' . \
  | grep -v node_modules | sed 's#.*docs\.spatius\.ai/##' | sort -u
# Compare the slugs above against navigation pages in <docs repo>/docs.json

# This repo: no references to the retired demo repo
grep -rn "spatius-avatar-demo" --include='*.md' . | grep -v node_modules

# Docs repo
cd <docs repo>
pnpm run check:spell
pnpm run check:grammar
pnpm run check:links
```
