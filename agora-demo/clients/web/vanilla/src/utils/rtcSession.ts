/**
 * The avatar's RTC session: ask the server for a channel, initialize the SDK, load
 * the avatar, connect, publish the microphone.
 *
 * The avatar joins the call itself. The client feeds it no driving data at all: the
 * agent encodes the animation into the video stream's SEI, the SDK parses it out to
 * drive rendering, and audio travels on an RTC track.
 *
 *   Direct    client ──audio──► Motion Server            (client drives)
 *   Backend   client ──mic───► server ──► Motion Server   (server drives)
 *   Agora     client ◄────  Agora channel  ────► agent    (neither — it is in the channel)
 *
 * So there is no `send()` and no `yieldAudioData()` here. Once connected, everything
 * arrives as a stream. `AvatarPlayer` only knows about the provider interface, and
 * `AgoraProvider` is the one used here; the LiveKit demo swaps in `LiveKitProvider`
 * with the rest of this file unchanged.
 */
import {
  AvatarManager,
  AvatarSDK,
  AvatarView,
  DrivingServiceMode,
  LogLevel,
} from '@spatius/avatarkit'
import {
  AgoraProvider,
  AvatarPlayer,
  type RTCConnectionConfig,
} from '@spatius/avatarkit-rtc'

/**
 * Where the server lives. Same host as the page, on its port.
 *
 * Read through a function rather than fixed at module load: Next.js prerenders
 * these components on the server, where there is no `location` to read, and a
 * top-level evaluation fails the build outright. Every call site runs in response
 * to a user action, so by then there is always a document.
 */
export function serverUrl(): string {
  // Both build systems' env objects, reached without naming either's globals:
  // this file is compiled by Vite in three clients and by Next in two, and a bare
  // `process` fails to typecheck wherever @types/node is not installed.
  const viteEnv = (import.meta as any).env
  const nodeEnv = (globalThis as any).process?.env
  const configured = viteEnv?.VITE_DEMO_SERVER_URL ?? nodeEnv?.NEXT_PUBLIC_DEMO_SERVER_URL
  if (configured) return configured
  if (typeof location === 'undefined') {
    throw new Error('The server URL is only resolvable in the browser')
  }
  return `${location.protocol}//${location.hostname}:8790`
}

/**
 * What the server tells a client on boot.
 *
 * No credential is in it. Everything the demo is configured with — the API key, the
 * Agora certificate, the pipeline id, the conversation language — lives in the
 * server's `.env` and never leaves that machine.
 */
export interface ServerConfig {
  /** The avatar loaded when the user has not picked one. */
  avatarId: string
  /** Which language the conversation runs in, for display only. */
  language: string
}

export async function fetchConfig(): Promise<ServerConfig> {
  const res = await fetch(`${serverUrl()}/api/config`)
  if (!res.ok) throw new Error(`Cannot reach the demo server (HTTP ${res.status})`)
  return (await res.json()) as ServerConfig
}

/** What the server hands back to join with. */
interface Session {
  sessionId: string
  spatiusAppId: string
  avatarId: string
  appId: string
  channelName: string
  uid: number
  /** The conversational agent's uid, watched for to tell whether it has joined. */
  agentUid: number
  token: string
}

let sdkInitialized = false

/**
 * Initialized once per page: the SDK reads the App ID only at initialize time, so it
 * cannot be changed afterwards without a reload.
 */
async function initializeSdk(appId: string): Promise<void> {
  if (sdkInitialized) return
  sdkInitialized = true
  await AvatarSDK.initialize(appId, {
    // The RTC driving mode has to be declared — AvatarPlayer validates it — and
    // getting it wrong files this path's telemetry under the wrong category.
    drivingServiceMode: DrivingServiceMode.rtc,
    logLevel: LogLevel.warning,
  })
}

export interface SessionCallbacks {
  /** Stage text for the waiting overlay. */
  onProgress?: (text: string) => void
  /** Model download progress, 0-100. Only fires on a cache miss. */
  onDownload?: (percent: number) => void
  /** The avatar's first rendered frame — what dismisses the overlay, not "connected". */
  onRendered?: () => void
}

export class RtcSession {
  private player: AvatarPlayer | null = null
  private provider: AgoraProvider | null = null
  private view: AvatarView | null = null
  private micStream: MediaStream | null = null
  private sessionId = ''
  /** The agent's uid, watched for in the channel's remote users. */
  private agentUid = 0
  /** Once started it is not started again — a session bills from the moment it is
   *  created. */
  private started = false

  constructor(private readonly callbacks: SessionCallbacks = {}) {}

  get id(): string {
    return this.sessionId
  }

  get isConnected(): boolean {
    return this.player?.isConnected ?? false
  }

  get micActive(): boolean {
    return this.micStream !== null
  }

  /**
   * `avatarId` is the only thing sent: the character the user picked, which the server
   * needs so the ConvoAI agent brings that same avatar into the channel. Language and
   * credentials are the server's own settings.
   */
  async start(container: HTMLElement, avatarId?: string): Promise<void> {
    if (this.started) return
    this.started = true

    const progress = (text: string) => this.callbacks.onProgress?.(text)

    progress('Creating a session…')
    const res = await fetch(`${serverUrl()}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ avatarId: avatarId ?? '' }),
    })
    if (!res.ok) {
      this.started = false
      throw new Error(`Could not start a session (HTTP ${res.status})`)
    }
    const session = (await res.json()) as Session
    this.sessionId = session.sessionId
    this.agentUid = session.agentUid ?? 0

    // Billing has started as of here, so any later failure has to stop the session.
    try {
      await initializeSdk(session.spatiusAppId)

      progress('Loading avatar…')
      const id = avatarId || session.avatarId
      // A cache hit skips the download, so re-entering does not run the progress bar
      // again.
      const cached = AvatarManager.shared.retrieve(id)
      const avatar =
        cached ??
        (await AvatarManager.shared.load(id, (info) => {
          if (typeof info.progress === 'number') {
            this.callbacks.onDownload?.(Math.round(info.progress))
          }
        }))
      if (!avatar) throw new Error('Avatar load returned null')

      // Emptied first: AvatarView appends a canvas rather than replacing what is
      // there, so a container reused after a failed or torn-down attempt — which
      // React's development double-invoke produces on every mount — ends up with
      // two avatars side by side.
      container.replaceChildren()
      this.view = new AvatarView(avatar, container)
      this.view.onFirstRendering = () => this.callbacks.onRendered?.()

      progress('Joining the channel…')
      const provider = new AgoraProvider()
      const player = new AvatarPlayer(provider, this.view, { logLevel: 'error' })
      this.player = player
      this.provider = provider

      // Subscribed before connecting, or the events fired at the moment of
      // connection are missed.
      player.on('stalled', () => {
        // Reconnect when the stream stalls, so the picture does not freeze.
        void player.reconnect().catch(e => console.warn('[rtc] reconnect failed', e))
      })

      const connection: RTCConnectionConfig = {
        appId: session.appId,
        channel: session.channelName,
        token: session.token,
        uid: session.uid,
      }
      await player.connect(connection)
      progress('Connected.')
    } catch (err) {
      console.error('[rtc] start failed', err)
      await this.stop()
      throw err
    }
  }

  /**
   * Wait until the agent is ready to be spoken to.
   *
   * ConvoAI starts the agent asynchronously after the session call returns, and audio
   * sent before it is in the channel is simply dropped — the symptom is a channel that
   * connects but never answers.
   *
   * Polled rather than subscribed because the client's `user-joined` event fires for
   * whoever arrives first, and the avatar's own publishing endpoint is in the channel
   * too — it generally beats the agent there. So the uid the server minted is what has
   * to be matched, and reading `remoteUsers` answers that directly.
   *
   * ConvoAI has no "ready" signal beyond joining; joined is the strongest available,
   * and in practice the engine is serving by then.
   */
  async waitForAgent(timeoutMs = 20000): Promise<boolean> {
    const client = this.provider?.getNativeClient() as
      | { remoteUsers?: Array<{ uid: string | number }> }
      | undefined
    if (!client || !this.agentUid) return false

    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (client.remoteUsers?.some(u => Number(u.uid) === this.agentUid)) return true
      await new Promise(r => setTimeout(r, 300))
    }
    return false
  }

  /**
   * Capture the microphone and publish it.
   *
   * Unlike the native clients, the web publishAudio wants the host to supply the
   * track — permission and device selection belong to the page in a browser, so the
   * SDK does not reach past it to call getUserMedia.
   */
  async publishMic(): Promise<void> {
    // Idempotent, and quiet when there is nothing to publish to. Callers should not
    // have to track whether the microphone is already open or whether the channel is
    // still connected — getting either wrong used to surface as an SDK error at the
    // user ("Not connected. Please call connect() first.") for an action that was
    // simply unnecessary.
    if (!this.player?.isConnected || this.micStream) return
    this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const track = this.micStream.getAudioTracks()[0]
    if (!track) throw new Error('No audio track')
    await this.player.publishAudio(track)
  }

  async unpublishMic(): Promise<void> {
    // Same as publishMic: closing a microphone that is not open, or one whose channel
    // has already gone, is a no-op rather than an error.
    if (!this.micStream) return
    if (this.player?.isConnected) {
      await this.player.unpublishAudio()
    }
    // We started the capture, so we stop it — otherwise the tab's recording
    // indicator stays lit.
    this.micStream?.getTracks().forEach(t => t.stop())
    this.micStream = null
  }

  /**
   * Stop the session explicitly rather than leaving it to ConvoAI's idle timeout —
   * that waits a minute, and the minute is billed.
   */
  async stop(): Promise<void> {
    try {
      await this.player?.disconnect()
    } catch (err) {
      console.warn('[rtc] disconnect failed', err)
    }
    this.micStream?.getTracks().forEach(t => t.stop())
    this.micStream = null
    this.player = null
    this.provider = null
    // Disposed rather than dropped: the view owns a canvas and a render loop, and
    // letting it go without this leaves both running behind the next one.
    try {
      this.view?.dispose()
    } catch (err) {
      console.warn('[rtc] view dispose failed', err)
    }
    this.view = null
    if (this.sessionId) {
      await stopSession(this.sessionId)
      this.sessionId = ''
    }
    this.started = false
  }
}

export async function stopSession(sessionId: string): Promise<void> {
  if (!sessionId) return
  try {
    await fetch(`${serverUrl()}/api/session/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    })
  } catch (err) {
    console.warn('[rtc] stop failed', err)
  }
}

/**
 * The stop sent as the page closes.
 *
 * sendBeacon rather than fetch: the page is unloading and the browser cuts ordinary
 * requests off, which would leave the agent up and billing. text/plain rather than
 * JSON because JSON triggers a preflight, and unload has no time to complete one.
 */
export function stopSessionOnUnload(sessionId: string): void {
  if (!sessionId) return
  const payload = JSON.stringify({ sessionId })
  const sent =
    typeof navigator.sendBeacon === 'function' &&
    navigator.sendBeacon(
      `${serverUrl()}/api/session/stop`,
      new Blob([payload], { type: 'text/plain' }),
    )
  if (!sent) void stopSession(sessionId)
}
