import { pushToast } from './utils/toast'
import {
  AvatarManager,
  AvatarView,
  type AnimationType,
  type AvatarController,
  type ConnectionState,
  type ConversationState,
} from '@spatius/avatarkit'

/**
 * What the SDK reports back, one field per public callback.
 *
 * Every one is registered whether or not this demo acts on it, and the status bar
 * shows them all: which hooks exist is part of what a reference client is for, and
 * a row that only appears once it has fired is a row nobody knows to expect.
 */
export interface AvatarInstance {
  uid: string
  characterId: string
  characterName: string
  view: AvatarView | null
  /** onConnectionState */
  connectionState: ConnectionState
  /** onConversationState */
  conversationState: ConversationState
  /** onAnimationState — which clip is driving the render. */
  animationState: AnimationType | null
  /** onPlaybackStall — audio paused waiting on animation frames (strictSync only). */
  stalled: boolean
  /** onFirstRendering — the first frame has been drawn. */
  rendered: boolean
  /** onFrameRateInfo — rolling render rate, null until monitoring is switched on. */
  fps: number | null
  /** AvatarManager.load's onProgress */
  loading: boolean
  loadProgress: number // 0..1
  /** onError */
  error: string | null
}

type Listener = () => void

let uidCounter = 0
const genUid = () => `avatar-${++uidCounter}`

export class AvatarManagerService {
  private _avatars: AvatarInstance[] = []
  private _activeUid: string | null = null
  private _views = new Map<string, AvatarView>()
  private _listeners = new Set<Listener>()

  get avatars() { return this._avatars }
  get activeUid() { return this._activeUid }
  get activeAvatar(): AvatarInstance | null {
    return this._avatars.find(a => a.uid === this._activeUid) ?? null
  }

  get activeController(): AvatarController | null {
    return this.activeAvatar?.view?.controller ?? null
  }

  onChange(fn: Listener) { this._listeners.add(fn); return () => this._listeners.delete(fn) }
  private notify() { this._listeners.forEach(fn => fn()) }

  private updateAvatar(uid: string, patch: Partial<AvatarInstance>) {
    this._avatars = this._avatars.map(a => a.uid === uid ? { ...a, ...patch } : a)
    this.notify()
  }

  setActiveUid(uid: string) {
    this._activeUid = uid
    this.notify()
  }

  async loadAvatar(
    characterId: string,
    characterName: string,
    container: HTMLElement,
    onProgress?: (progress: number) => void,
  ): Promise<string> {
    const uid = genUid()
    const inst: AvatarInstance = {
      uid, characterId, characterName,
      view: null,
      connectionState: 'disconnected' as ConnectionState,
      conversationState: 'idle' as ConversationState,
      animationState: null,
      stalled: false,
      rendered: false,
      fps: null,
      loading: true, loadProgress: 0, error: null,
    }
    this._avatars = [...this._avatars, inst]
    this._activeUid = uid
    this.notify()

    try {
      const avatar = await AvatarManager.shared.load(characterId, (info) => {
        const p = info.progress ?? 0
        this.updateAvatar(uid, { loadProgress: p })
        onProgress?.(p)
      })
      const view = new AvatarView(avatar, container)
      view.controller.onConnectionState = (state: ConnectionState) => this.updateAvatar(uid, { connectionState: state })
      view.controller.onConversationState = (state: ConversationState) => this.updateAvatar(uid, { conversationState: state })
      view.controller.onError = (err: Error) => {
        this.updateAvatar(uid, { error: err.message })
        pushToast(err.message)
      }

      // The rest are registered even though this demo does not act on them: the
      // status bar lists every public callback, and one that is never hooked up
      // would sit at its initial value looking broken.
      view.controller.onAnimationState = (type: AnimationType) => this.updateAvatar(uid, { animationState: type })
      view.controller.onPlaybackStall = (stalled: boolean) => this.updateAvatar(uid, { stalled })
      view.onFirstRendering = () => this.updateAvatar(uid, { rendered: true })
      // Off by default and free while off, so it is switched on here to give the
      // status bar something to report.
      view.controller.frameRateMonitorEnabled = true
      view.controller.onFrameRateInfo = (info) => {
        // `fps` is the measured render rate; `presentationFps` is what actually
        // reached the screen. Guarded because a window with no frames in it — a
        // hidden tab, the gap between rounds — averages to NaN.
        const fps = Number.isFinite(info.fps) ? Math.round(info.fps) : null
        this.updateAvatar(uid, { fps })
      }

      this._views.set(uid, view)
      this.updateAvatar(uid, { view, loading: false })
      return uid
    } catch (e: any) {
      this.updateAvatar(uid, { loading: false, error: e.message })
      throw e
    }
  }

  removeAvatar(uid: string) {
    const view = this._views.get(uid)
    if (view) { view.controller.close(); view.dispose(); this._views.delete(uid) }
    this._avatars = this._avatars.filter(a => a.uid !== uid)
    if (this._activeUid === uid) {
      const remaining = [...this._views.keys()]
      this._activeUid = remaining[0] ?? null
    }
    this.notify()
  }

  removeAll() {
    this._views.forEach(v => { v.controller.close(); v.dispose() })
    this._views.clear()
    this._avatars = []
    this._activeUid = null
    this.notify()
  }

  dispose() {
    this._views.forEach(v => { v.controller.close(); v.dispose() })
    this._views.clear()
    this._listeners.clear()
  }
}
