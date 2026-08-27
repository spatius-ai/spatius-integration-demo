/**
 * The one connection a Backend Mode client has.
 *
 * Backend Mode means the **server** owns the Motion Server connection: it drives the
 * avatar and sends back encoded audio plus motion messages. This client never talks
 * to Spatius — it captures microphone audio and renders what arrives.
 *
 * That is the whole difference from Direct Mode. There, the client holds a Session
 * Token and calls `controller.send()`; here the same audio reaches the avatar
 * server-side, and the client feeds the rendering pipeline instead:
 *
 *   avatar_audio   → controller.yieldAudioData(pcm, isLast) → returns a conversation id
 *   avatar_frames  → controller.yieldFramesData(batches, conversationId)
 *
 * Both scenes produce those same two messages, so nothing below cares which one is
 * running.
 */
import type { AvatarController } from '@spatius/avatarkit'

/**
 * Where the server lives. Same host as the page, on the backend's port.
 *
 * Read through functions rather than fixed at module load: Next.js prerenders
 * these components on the server, where there is no `location` to read, and a
 * top-level evaluation fails the build outright. Every call site runs in response
 * to a user action, so by then there is always a document.
 */
export function backendWsUrl(): string {
  // Both build systems' env objects, reached without naming either's globals:
  // this file is compiled by Vite in three clients and by Next in two, and a bare
  // `process` fails to typecheck wherever @types/node is not installed.
  const viteEnv = (import.meta as any).env
  const nodeEnv = (globalThis as any).process?.env
  const configured =
    viteEnv?.VITE_BACKEND_MODE_WS_URL ?? nodeEnv?.NEXT_PUBLIC_BACKEND_MODE_WS_URL
  if (configured) return configured
  if (typeof location === 'undefined') {
    throw new Error('The backend URL is only resolvable in the browser')
  }
  return `ws://${location.hostname}:8765/ws/agent`
}

export function backendHttpUrl(): string {
  return backendWsUrl()
    .replace(/^ws:/, 'http:')
    .replace(/^wss:/, 'https:')
    .replace(/\/ws\/agent$/, '')
}

export interface BackendConfig {
  appId: string
  avatarId: string
  region: string
  outputSampleRate: number
  inputSampleRate: number
  /** Credentials already saved on the server, blank when nothing is stored yet. */
  SPATIUS_APP_ID?: string
  SPATIUS_API_KEY?: string
  SPATIUS_AVATAR_ID?: string
  SPATIUS_REGION?: string
  LIVEKIT_URL?: string
  LIVEKIT_API_KEY?: string
  LIVEKIT_API_SECRET?: string
  /** Which credentials each scene is still waiting on. */
  missing: { sample: string[]; realtime: string[] }
  /** The clips the pre-recorded scene can play, as listed by the server. */
  clips: { name: string; clip: string }[]
  clipsHint: string
}

export async function fetchConfig(): Promise<BackendConfig> {
  const res = await fetch(`${backendHttpUrl()}/api/config`)
  if (!res.ok) throw new Error(`Cannot reach the Backend Mode server (HTTP ${res.status})`)
  return (await res.json()) as BackendConfig
}

/**
 * Save credentials to the server's `.env`, so the next visit starts with them in
 * place.
 *
 * One stored copy rather than per-browser state: a phone has no `.env` to edit and
 * no shared localStorage, so entering an API key there once should be enough.
 */
export async function saveConfig(values: Record<string, string>): Promise<void> {
  const res = await fetch(`${backendHttpUrl()}/api/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(values),
  })
  if (!res.ok) throw new Error(`Could not save configuration (HTTP ${res.status})`)
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  // In chunks: spreading a whole buffer into fromCharCode blows the stack once the
  // audio is more than a second or so long.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

export interface BackendCallbacks {
  onReady?: (config: { appId: string; avatarId: string }) => void
  onAgentReady?: () => void
  /** The avatar started producing sound. */
  onSpeaking?: () => void
  onTranscript?: (role: 'user' | 'assistant', text: string) => void
  onError?: (message: string) => void
  onClosed?: () => void
}

export class BackendClient {
  private socket: WebSocket | null = null
  private controller: AvatarController | null = null
  private agentReady: Promise<void> | null = null
  private resolveAgentReady: (() => void) | null = null
  /** The id `yieldAudioData` handed back, which frames for the same reply need. */
  private conversationId: string | null = null

  /**
   * Mutable so a panel mounted after the connection can attach its own handlers —
   * ControlPanel creates the client on Connect, and the scene panels come later.
   */
  callbacks: BackendCallbacks

  constructor(callbacks: BackendCallbacks = {}) {
    this.callbacks = callbacks
  }

  get isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN
  }

  /** Where rendered audio and motion go. Set before connecting. */
  setController(controller: AvatarController | null): void {
    this.controller = controller
  }

  async connect(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(backendWsUrl())
      this.socket = socket

      const timer = window.setTimeout(
        () => reject(new Error('Timed out connecting to the Backend Mode server')),
        15_000,
      )

      socket.onmessage = (event) => {
        let msg: any
        try {
          msg = JSON.parse(event.data)
        } catch {
          return
        }
        switch (msg.type) {
          case 'ready':
            window.clearTimeout(timer)
            this.callbacks.onReady?.(msg.avatar ?? {})
            resolve()
            break
          case 'agent_ready':
            this.resolveAgentReady?.()
            this.resolveAgentReady = null
            this.callbacks.onAgentReady?.()
            break
          case 'avatar_audio': {
            const controller = this.controller
            if (!controller) break
            const bytes = msg.audio ? base64ToBytes(msg.audio) : new Uint8Array(0)
            this.conversationId =
              controller.yieldAudioData(bytes, msg.isLast ?? false) ?? this.conversationId
            if (bytes.length) this.callbacks.onSpeaking?.()
            break
          }
          case 'avatar_frames': {
            const controller = this.controller
            if (!controller || !this.conversationId) break
            const frames = (msg.frames ?? []).map((f: string) => base64ToBytes(f))
            if (frames.length) controller.yieldFramesData(frames, this.conversationId)
            if (msg.isLast) this.conversationId = null
            break
          }
          case 'transcript':
            this.callbacks.onTranscript?.(msg.role, msg.text)
            break
          case 'interrupt':
            this.controller?.interrupt()
            this.conversationId = null
            break
          case 'error':
            // Releases a pending startAgent too: a failure there would otherwise
            // sit on the timeout with the button stuck on "Starting…".
            this.agentReady = null
            this.resolveAgentReady?.()
            this.resolveAgentReady = null
            this.callbacks.onError?.(msg.message || 'Server error')
            break
        }
      }

      socket.onerror = () => {
        window.clearTimeout(timer)
        reject(new Error(`Cannot reach the server at ${backendWsUrl()}`))
      }

      socket.onclose = () => {
        this.conversationId = null
        this.agentReady = null
        this.resolveAgentReady?.()
        this.resolveAgentReady = null
        this.callbacks.onClosed?.()
      }
    })
  }

  private send(payload: Record<string, unknown>): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload))
    }
  }

  setAvatar(avatarId: string): void {
    this.send({ type: 'set_avatar', avatarId })
  }

  /** Scene one: ask the server to drive the avatar from one of its bundled clips. */
  playSample(clip: string): void {
    this.send({ type: 'play_sample', clip })
  }

  /**
   * Scene two: bring the conversational agent up, resolving once it is listening.
   *
   * Awaitable rather than fire-and-forget: microphone audio pushed before the agent
   * exists is dropped, and that presents as a mic that records nothing.
   */
  startAgent(language: string): Promise<void> {
    if (this.agentReady) return this.agentReady
    this.agentReady = new Promise<void>((resolve, reject) => {
      this.resolveAgentReady = resolve
      const timer = window.setTimeout(() => {
        this.agentReady = null
        this.resolveAgentReady = null
        reject(new Error('Timed out waiting for the agent'))
      }, 30_000)
      const done = this.resolveAgentReady
      this.resolveAgentReady = () => {
        window.clearTimeout(timer)
        done()
      }
    })
    this.send({ type: 'start_agent', language })
    return this.agentReady
  }

  pushMicAudio(pcm16: ArrayBuffer): void {
    this.send({ type: 'mic_audio', audio: bytesToBase64(new Uint8Array(pcm16)) })
  }

  say(text: string): void {
    this.send({ type: 'text', text })
  }

  interrupt(): void {
    this.controller?.interrupt()
    this.conversationId = null
    this.send({ type: 'interrupt' })
  }

  close(): void {
    this.socket?.close()
    this.socket = null
    this.conversationId = null
  }
}
