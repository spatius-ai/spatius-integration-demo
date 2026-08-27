/**
 * The avatar itself: initialize the SDK, load the character, connect to Motion Server.
 *
 * Shared by both scenes, because in Direct Mode they differ only in where the audio
 * comes from. Everything here is the same either way, and both end at `send()`.
 */
import {
  AvatarManager,
  AvatarSDK,
  AvatarView,
  ConnectionState,
  DrivingServiceMode,
  LogLevel,
  type AvatarController,
} from '@spatius/avatarkit'
import { fetchConfig, fetchSessionToken, type BackendConfig } from './backend'

const CONNECT_TIMEOUT_MS = 15_000

export interface AvatarCallbacks {
  /** Stage text for a loading overlay — "Loading avatar", "Connecting", and so on. */
  onProgress?: (text: string) => void
  /** Model download progress, 0-100. Only fires on a cache miss. */
  onDownload?: (percent: number) => void
  onError?: (message: string) => void
}

/**
 * Wait for the animation channel to come up.
 *
 * `start()` resolving is not enough on its own: it means the request went out, not
 * that the channel is usable, and audio sent in that window is dropped. The symptom
 * is an avatar that connects and then never moves.
 */
function waitForChannel(controller: AvatarController): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    let lastError: string | null = null

    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      error ? reject(error) : resolve()
    }

    const timer = window.setTimeout(
      () => finish(new Error(lastError ?? 'Timed out connecting to Motion Server')),
      CONNECT_TIMEOUT_MS,
    )

    controller.onConnectionState = (state) => {
      if (state === ConnectionState.connected) finish()
      // Let onError land first: it carries the reason, and without the small delay
      // the failure is reported as a bare "failed" with nothing to act on.
      else if (state === ConnectionState.failed) {
        window.setTimeout(() => finish(new Error(lastError ?? 'Connection failed')), 100)
      }
    }
    controller.onError = (error) => {
      lastError = error instanceof Error ? error.message : String(error)
      finish(new Error(lastError))
    }
  })
}

/**
 * One connected avatar.
 *
 * Created per scene entry and disposed on the way out. The SDK is initialized once per
 * page — it reads the App ID only at initialize time — so switching scenes reuses it.
 */
export class AvatarSession {
  private view: AvatarView | null = null
  config: BackendConfig | null = null

  constructor(private readonly callbacks: AvatarCallbacks = {}) {}

  get controller(): AvatarController | null {
    return this.view?.controller ?? null
  }

  get isConnected(): boolean {
    return this.view !== null
  }

  /**
   * Bring the avatar up: config → token → SDK → character → Motion Server.
   *
   * Must be called from a user gesture. `initializeAudioContext()` needs one, and a
   * browser will not create an AudioContext outside it — the avatar then renders in
   * silence with nothing reported.
   */
  async connect(
    container: HTMLElement,
    /** Passed to `AvatarSDK.initialize()`. */
    appId: string,
    avatarId?: string,
    /** Exchanged for a Session Token. Omit to use the key in the server's `.env`. */
    apiKey?: string,
  ): Promise<void> {
    const progress = (text: string) => this.callbacks.onProgress?.(text)

    progress('Reading server config...')
    const config = await fetchConfig()
    this.config = config

    progress('Requesting a session token...')
    const session = await fetchSessionToken(apiKey)

    if (!AvatarSDK.configuration) {
      await AvatarSDK.initialize(appId, {
        drivingServiceMode: DrivingServiceMode.direct,
        audioFormat: { channelCount: 1, sampleRate: config.sampleRate },
        logLevel: LogLevel.warning,
        // Follow the region the backend reports; omitting it lets the SDK pick.
        ...(session.region ? { region: session.region } : {}),
      })
    }
    AvatarSDK.setSessionToken(session.sessionToken)

    const id = avatarId || session.avatarId || config.avatarId
    progress('Loading avatar...')
    // A cached avatar skips the download, so re-entering a scene does not run the
    // progress bar again.
    const cached = AvatarManager.shared.retrieve(id)
    const avatar =
      cached ??
      (await AvatarManager.shared.load(id, (info) => {
        if (typeof info.progress === 'number') {
          this.callbacks.onDownload?.(Math.round(info.progress))
        }
      }))

    this.view = new AvatarView(avatar, container)
    const controller = this.view.controller

    progress('Connecting to Motion Server...')
    await controller.initializeAudioContext()
    // Both together: the channel can come up before start() resolves, and waiting on
    // them in sequence would miss it.
    const channelReady = waitForChannel(controller)
    await Promise.all([controller.start(), channelReady])

    controller.onError = (error) => {
      this.callbacks.onError?.(error instanceof Error ? error.message : String(error))
    }
    progress('Connected.')
  }

  /**
   * Send audio to Motion Server. This is where both scenes end up.
   *
   * @param end marks the last chunk of a turn, which is what lets the avatar return to
   *            idle rather than holding the final mouth shape.
   */
  send(pcm16: ArrayBuffer, end = false): void {
    this.controller?.send(pcm16, end)
  }

  interrupt(): void {
    this.controller?.interrupt()
  }

  pause(): void {
    this.controller?.pause()
  }

  async resume(): Promise<void> {
    await this.controller?.resume()
  }

  dispose(): void {
    if (!this.view) return
    this.view.controller.close()
    this.view.dispose()
    this.view = null
  }
}
