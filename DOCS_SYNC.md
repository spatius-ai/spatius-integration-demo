# Demo and Docs Sync Guide

This repository and the public docs must be updated together. Demo paths should match the user-facing integration paths used in docs.

## Integration Path Map

| User-facing path | Demo directories | Docs pages to update |
| --- | --- | --- |
| Direct Mode | `direct-mode/clients/*`, `direct-mode/servers/*` | `getting-started/how-to-integrate`, `quickstarts/*`, `direct-mode/*`, `resources/demo-projects`, relevant client SDK references |
| LiveKit Agents Integration | `platform-integrations/livekit-agents-demo/livekit-agent-quickstart`, `platform-integrations/livekit-agents-demo/livekit-agents-reference-demo` | `getting-started/how-to-integrate`, `livekit-agents/*`, `resources/demo-projects`, Web RTC Adapter references |
| Backend Mode | `backend-mode` | `getting-started/how-to-integrate`, `backend-mode/*`, `resources/demo-projects`, relevant Server SDK references |
| RTC Mode | `rtc-mode/clients/*`, `rtc-mode/servers/*` | `getting-started/how-to-integrate`, `rtc-mode/*`, `resources/demo-projects`, Web RTC Adapter references |

`platform-integrations/livekit-room-demo` is the minimal LiveKit example for `@spatius/avatarkit-rtc` (the RTC Adapter) with `LiveKitProvider`. It validates token issuance, room connection, adapter + provider init, avatar load and render, and mic publishing. Remote audio playback and motion rendering only happen when a producer publishes into the room — this demo has no agent, Server SDK, or Motion Server producer of its own. Keep it aligned with `sdk-reference/web-sdk/rtc-adapter`, `backend-mode/with-livekit`, `livekit-agents/client`, and `resources/demo-projects`.

## Sync Rules

- If a demo path, run command, required env var, package name, default endpoint, or avatar ID changes, update the matching docs page in `../docs`.
- If a docs guide introduces a new recommended flow, add or update the matching demo README in this repository.
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
# Docs repo
cd ../docs
pnpm run check:spell
pnpm run check:grammar
pnpm run check:links
```

Also run the migration residual search from the current migration checklist against both repositories.
