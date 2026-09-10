# Demo and Docs Sync Guide

This repository and the public docs (`spatius-ai/docs`, published at `https://docs.spatius.ai`) must be updated together. Demo paths should match the user-facing integration paths used in docs.

The docs site exposes exactly four integrations: LiveKit Agents Integration, Agora Convo AI Integration, Direct Mode Integration, and Backend Mode Integration. `livekit-demo` is the demo for the LiveKit Agents integration and `agora-demo` for the Agora Convo AI integration; neither is a separate docs entry.

Complete scenario quickstarts (`quickstarts/*`) come from `spatius-ai/spatius-scenario-demo`, not from this repository.

## Integration Path Map

| User-facing path | Demo directories | Docs pages to update |
| --- | --- | --- |
| Direct Mode | `direct-mode/clients/*`, `direct-mode/servers/*` | `integrations/overview`, `direct-mode/client`, `resources/demo-projects`, relevant client SDK references under `sdk-reference/*` |
| Backend Mode | `backend-mode/clients/*`, `backend-mode/servers/*` | `integrations/overview`, `backend-mode/server-sdk`, `backend-mode/client-sdk`, `resources/demo-projects`, relevant Server SDK references under `sdk-reference/*` |
| LiveKit Agents Integration | `livekit-demo/clients/*`, `livekit-demo/servers/*`, `platform-integrations/livekit-agents-demo/livekit-agent-quickstart`, `platform-integrations/livekit-agents-demo/livekit-agents-reference-demo` | `integrations/overview`, `livekit-agents/overview`, `livekit-agents/server`, `livekit-agents/client`, `resources/demo-projects`, `sdk-reference/web-sdk/rtc-adapter` |
| Agora Convo AI Integration | `agora-demo/clients/*`, `agora-demo/servers/*` | `integrations/overview`, `agora-convoai/overview`, `agora-convoai/convo-ai-agent`, `agora-convoai/ten-extension`, `agora-convoai/client`, `resources/demo-projects`, `sdk-reference/web-sdk/rtc-adapter`, mobile RTC SDK references |

`platform-integrations/livekit-room-demo` is the minimal LiveKit example for `@spatius/avatarkit-rtc` (the RTC Adapter) with `LiveKitProvider`. It validates token issuance, room connection, adapter + provider init, avatar load and render, and mic publishing. Remote audio playback and motion rendering only happen when a producer publishes into the room — this demo has no agent, Server SDK, or Motion Server producer of its own. Keep it aligned with `sdk-reference/web-sdk/rtc-adapter`, `livekit-agents/client`, and `resources/demo-projects`.

## Sync Rules

- If a demo path, run command, required env var, package name, default endpoint, or avatar ID changes, update the matching docs page in the docs repo.
- If a docs guide introduces a new recommended flow, add or update the matching demo README in this repository.
- Keep the demos presented as one set. Each has a server whose `.env` is the only place anything is configured (credentials, region, conversation language, voice) and a client that opens straight on the playground and sends the server nothing but the picked character; they differ only in who connects to Motion Server — the client (Direct), the server (Backend), or neither, with the avatar itself in the call (the LiveKit and Agora demos, which differ in where the agent runs).
- Every demo is realtime conversation only. There is no sample-audio scene, no configuration page, and no credential entry on any client; docs must not describe one.
- Client server-address configuration is build-time only: `VITE_*` / `NEXT_PUBLIC_*` env vars on web, `local.properties` → `BuildConfig` on Android, `Config.swift` on iOS, `lib/config.dart` on Flutter. Keep those names in sync with the docs.
- Keep package examples on compatible latest ranges where the package manager supports it:
  - npm: `^1.0.0`
  - Python: `>=1.0.0,<2.0.0` or the current LiveKit-compatible `>=1.5.8,<2.0.0`
  - Android: `1.+`
- Do not commit local lockfiles for demo dependency resolution. Fresh installs should resolve the latest compatible SDK package.

## Verification Checklist

Run these before publishing related changes:

```bash
# This repo: every docs link must resolve to a page in the docs navigation
grep -rno "docs\.spatius\.ai/[^ )\`\"'>#]*" --include='*.md' --include='*.example' --include='*.py' --include='*.ts' --include='*.swift' --include='*.kt' --include='*.dart' . \
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
