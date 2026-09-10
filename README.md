<h1 align="center">Spatius AvatarKit Demos</h1>

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
- **Multiple architectures** — Direct Mode, LiveKit Agents, and Backend Mode integration paths
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

> **New here?** Start with [`direct-mode`](./direct-mode): fill in its server's `.env`, run
> the server, then the React client, pick a character and talk.

Every demo is a realtime conversation with the avatar. All configuration — credentials,
region, conversation language, voice — lives in the server's `.env`; the clients open straight
on the playground and only tell the server which character was picked. The demos differ only
in who holds the Motion Server connection. The two RTC demos share that answer — nobody, the
avatar is in the call — and differ in where the conversation runs:

| Mode | Who connects to Motion Server | Where the conversation runs |
| --- | --- | --- |
| [**Direct**](./direct-mode) | the client | your server (ASR / LLM / TTS over a WebSocket), the client drives the avatar |
| [**Backend**](./backend-mode) | the server | your server, which also drives the avatar and relays audio + motion |
| [**LiveKit**](./livekit-demo) | neither — the avatar joins the LiveKit room itself | a LiveKit agent on your machine |
| [**Agora**](./agora-demo) | neither — the avatar joins the Agora channel itself | Agora's Conversational AI Engine |

| Platform | Direct Mode | Backend Mode | LiveKit Demo | Agora Demo |
| --- | --- | --- | --- | --- |
| **Web** | [`direct-mode/clients/web/reference`](./direct-mode/clients/web/reference) — React, Vue, vanilla, Next.js | [`backend-mode/clients/web`](./backend-mode/clients/web) | [`livekit-demo/clients/web`](./livekit-demo/clients/web) | [`agora-demo/clients/web`](./agora-demo/clients/web) |
| **iOS** | [`direct-mode/clients/ios`](./direct-mode/clients/ios) | [`backend-mode/clients/ios`](./backend-mode/clients/ios) | Web-only | [`agora-demo/clients/ios`](./agora-demo/clients/ios) |
| **Android** | [`direct-mode/clients/android`](./direct-mode/clients/android) | [`backend-mode/clients/android`](./backend-mode/clients/android) | Web-only | [`agora-demo/clients/android`](./agora-demo/clients/android) |
| **Flutter** | [`direct-mode/clients/flutter`](./direct-mode/clients/flutter) | [`backend-mode/clients/flutter`](./backend-mode/clients/flutter) | Web-only | Web-only |

For LiveKit Agents specifically, see [`livekit-agent-quickstart`](./platform-integrations/livekit-agents-demo/livekit-agent-quickstart) and the [reference demo](./platform-integrations/livekit-agents-demo/livekit-agents-reference-demo).

Transport options such as LiveKit, Agora, and your own WebSocket transport live inside the relevant integration docs. [`platform-integrations/livekit-room-demo`](./platform-integrations/livekit-room-demo) is the minimal LiveKit example for `@spatius/avatarkit-rtc` (the RTC Adapter) with `LiveKitProvider`: it validates token issuance, room connection, adapter init, avatar load, and mic publishing. Remote audio playback and motion rendering only happen when a producer publishes into the room — this demo has no agent or Backend Mode publisher. Not the full Backend Mode + RTC transport voice-agent demo.

### Direct Mode servers vs Backend Mode servers

Direct Mode clients connect to Motion Server directly, but they still need a short-lived Session Token. The server under `direct-mode/servers/python` keeps `SPATIUS_API_KEY` on the backend, mints Session Tokens, and runs the conversation (ASR / LLM / TTS) over a WebSocket — the client hands the assistant audio to the SDK itself. It never connects to Motion Server and never relays motion.

Backend Mode servers are runtime servers. They own the ASR / LLM / TTS pipeline, use a Server SDK to connect to Motion Server, and deliver encoded audio + motion messages to clients.

## Quick Start

The fastest Web SDK path is Direct Mode. The server holds the credentials and mints
Session Tokens, so start it first:

```bash
git clone https://github.com/spatius-ai/spatius-integration-demo.git
cd spatius-integration-demo/direct-mode/servers/python

cp .env.example .env
# Fill in the Spatius and LiveKit values; language and voice live here too.
# The server refuses to start while a required key is missing.

uv run app.py
```

Then the client, in a second terminal:

```bash
cd spatius-integration-demo/direct-mode/clients/web/reference/react
pnpm install
pnpm dev
```

Open `http://localhost:5173`. The client opens on the playground: choose a character, press
Start, and talk. Nothing is configured on the client — it reads the server address from an
environment variable (defaulting to the same host) and everything else from the server.

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
