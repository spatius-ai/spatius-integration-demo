# RTC Adapter — LiveKit example (Web client)

## Purpose

Web client for the LiveKit Room example. Fetches a token from the matching token server, joins the LiveKit room via `@spatius/avatarkit-rtc` (the [RTC Adapter](https://docs.spatius.ai/sdk-reference/web-sdk/rtc-adapter)) + `LiveKitProvider`, loads the avatar, and starts mic publishing. Remote audio playback and motion-driven rendering only happen if a remote producer is publishing into the room — this demo alone has no audio or motion publisher.

## Run

```bash
cp .env.example .env
pnpm install
pnpm dev
```

Default URL: `http://localhost:3003`

## Backend Dependency

Run `../../servers/python` in parallel (default `http://localhost:8081`).

## References

- Spatius App ID: https://app.spatius.ai/apps
- Spatius Avatar ID (test avatars): https://app.spatius.ai/avatars/library
- Session token guide: https://docs.spatius.ai/api-reference/auth
- LiveKit cloud: https://cloud.livekit.io/
