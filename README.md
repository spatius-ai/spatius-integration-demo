<h1 align="center">Spatius Integration Demos</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@spatius/avatarkit"><img src="https://img.shields.io/npm/v/%40spatius%2Favatarkit?label=%40spatius%2Favatarkit&color=0ea5e9" alt="npm" /></a>
  <a href="https://central.sonatype.com/artifact/ai.spatius/avatarkit"><img src="https://img.shields.io/maven-central/v/ai.spatius/avatarkit?label=Maven%20Central&color=0ea5e9" alt="Maven Central" /></a>
  <a href="https://github.com/spatius-ai/avatarkit-ios-release/releases"><img src="https://img.shields.io/github/v/release/spatius-ai/avatarkit-ios-release?label=iOS&color=0ea5e9" alt="iOS" /></a>
  <br/>
  <a href="https://docs.spatius.ai/"><img src="https://img.shields.io/badge/docs-spatius.ai-blue" alt="Docs" /></a>
</p>

<p align="center">
  A collection of demo projects showing how to integrate <a href="https://docs.spatius.ai/">AvatarKit</a> into avatar applications.<br/>
  Multiple integration paths · Multi-platform clients · Production-ready pipelines
</p>

## Features

- **Runnable examples** — Each demo is self-contained with clients, the required server-side piece, and `.env` config
- **Three architectures** — Direct, Backend and RTC Mode, plus LiveKit Agents integration paths
- **Multi-provider backends** — Swap between OpenAI, Google Gemini, Deepgram, Cartesia, Azure, AWS, and more
- **Cross-platform** — Web (React, Vue, Vanilla JS, Next.js), iOS, Android, and Flutter

## AvatarKit SDKs

<table>
  <tr>
    <th>Platform</th>
    <th>Package</th>
    <th>Links</th>
  </tr>
  <tr>
    <td><b>Web</b></td>
    <td><code>@spatius/avatarkit</code></td>
    <td><a href="https://www.npmjs.com/package/@spatius/avatarkit">npm</a> · <a href="https://docs.spatius.ai/">docs</a></td>
  </tr>
  <tr>
    <td><b>Android</b></td>
    <td><code>ai.spatius:avatarkit</code></td>
    <td><a href="https://central.sonatype.com/artifact/ai.spatius/avatarkit">Maven Central</a> · <a href="https://docs.spatius.ai/">docs</a></td>
  </tr>
  <tr>
    <td><b>iOS</b></td>
    <td><code>AvatarKit.xcframework</code></td>
    <td><a href="https://github.com/spatius-ai/avatarkit-ios-release/releases">GitHub Releases</a> · <a href="https://docs.spatius.ai/">docs</a></td>
  </tr>
  <tr>
    <td><b>Flutter</b></td>
    <td><code>spatius</code></td>
    <td><a href="https://pub.dev/packages/spatius">pub.dev</a> · <a href="https://docs.spatius.ai/">docs</a></td>
  </tr>
</table>

## Demos

> **New here?** Start with [`direct-mode`](./direct-mode): run its server, then the
> React client, and play the bundled sample audio. Switch the same UI to realtime
> conversation once you have LiveKit credentials.

The three modes differ only in who holds the Motion Server connection:

| Mode | Who connects to Motion Server | Scenes |
| --- | --- | --- |
| [**Direct**](./direct-mode) | the client | sample audio, realtime conversation |
| [**Backend**](./backend-mode) | the server | sample audio, realtime conversation |
| [**RTC**](./rtc-mode) | neither — the avatar joins the call itself | realtime conversation |

| Platform | Direct Mode | Backend Mode | RTC Mode |
| --- | --- | --- | --- |
| **Web** | [`direct-mode/clients/web/reference`](./direct-mode/clients/web/reference) — React, Vue, vanilla, Next.js | [`backend-mode/clients/web`](./backend-mode/clients/web) | [`rtc-mode/clients/web`](./rtc-mode/clients/web) |
| **iOS** | [`direct-mode/clients/ios`](./direct-mode/clients/ios) | [`backend-mode/clients/ios`](./backend-mode/clients/ios) | [`rtc-mode/clients/ios`](./rtc-mode/clients/ios) |
| **Android** | [`direct-mode/clients/android`](./direct-mode/clients/android) | [`backend-mode/clients/android`](./backend-mode/clients/android) | [`rtc-mode/clients/android`](./rtc-mode/clients/android) |
| **Flutter** | [`direct-mode/clients/flutter`](./direct-mode/clients/flutter) | [`backend-mode/clients/flutter`](./backend-mode/clients/flutter) | — |

For LiveKit Agents specifically, see [`livekit-agent-quickstart`](./platform-integrations/livekit-agents-demo/livekit-agent-quickstart) and the [reference demo](./platform-integrations/livekit-agents-demo/livekit-agents-reference-demo).

Transport options such as LiveKit, Agora, and your own WebSocket transport live inside the relevant integration docs. [`platform-integrations/livekit-room-demo`](./platform-integrations/livekit-room-demo) is the minimal LiveKit example for `@spatius/avatarkit-rtc` (the RTC Adapter) with `LiveKitProvider`: it validates token issuance, room connection, adapter init, avatar load, and mic publishing. Remote audio playback and motion rendering only happen when a producer publishes into the room — this demo has no agent or Backend Mode publisher. Not the full Backend Mode + RTC transport voice-agent demo.

### Direct Mode token servers vs Backend Mode servers

Direct Mode clients connect to Motion Server directly, but they still need a short-lived Session Token. The examples under `direct-mode/servers/` are token servers only: they keep `SPATIUS_API_KEY` on the backend and mint Session Tokens for clients. They do not run ASR, LLM, TTS, Motion Server connections, or audio / motion relay.

Backend Mode servers are runtime servers. They own the ASR / LLM / TTS pipeline, use a Server SDK to connect to Motion Server, and deliver encoded audio + motion messages to clients.

## Quick Start

The fastest Web SDK path is Direct Mode. The server holds the credentials and mints
Session Tokens, so start it first:

```bash
git clone https://github.com/spatius-ai/spatius-integration-demo.git
cd spatius-integration-demo/direct-mode/servers/python

cp .env.example .env
# Fill SPATIUS_API_KEY and SPATIUS_APP_ID. The realtime scene also needs the
# LiveKit values; the sample-audio scene runs without them.

uv run app.py
```

Then the client, in a second terminal:

```bash
cd spatius-integration-demo/direct-mode/clients/web/reference/react
pnpm install
pnpm dev
```

Open `http://localhost:5173`.

Pick a scene on the configuration page — **Sample audio** plays a bundled clip,
**Realtime conversation** runs a voice agent on the server — then choose a character and
press Start. Anything left blank in `.env` can be filled in on that page instead, which is
what makes the demo reachable from a phone on the same network.

The same client is provided for Vue, vanilla JS and Next.js alongside `react/`; see
[`direct-mode/README.md`](./direct-mode/README.md).

## Prerequisites

| Tool | Version | Link |
|------|---------|------|
| Node.js | 18+ | [nodejs.org](https://nodejs.org/) |
| pnpm | latest | [pnpm.io](https://pnpm.io/) |
| Python | 3.10+ | [python.org](https://www.python.org/) |
| uv | latest | [docs.astral.sh/uv](https://docs.astral.sh/uv/) |

You will also need:

- A **Spatius** account — [Create one in Studio](https://app.spatius.ai/)
- A **LiveKit Cloud** account (or self-hosted) — [cloud.livekit.io](https://cloud.livekit.io/)
- API keys for your chosen LLM / TTS / STT providers when you run agent or backend pipeline demos

## Links

- [Studio](https://app.spatius.ai/) — Manage apps, avatars, and API keys
- [Playground](https://playground.spatius.ai/) — Try avatars in the browser
- [Documentation](https://docs.spatius.ai/) — Guides and API reference
