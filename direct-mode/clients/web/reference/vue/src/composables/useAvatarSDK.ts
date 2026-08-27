import { ref, computed, onUnmounted, type Ref } from 'vue'
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

let uidCounter = 0
const genUid = () => `avatar-${++uidCounter}`

/**
 * @param onError surfaced to the UI so SDK failures are visible without the
 * developer console — see Toast.
 */
export function useAvatarManager(onError?: (message: string) => void) {
  const avatars: Ref<AvatarInstance[]> = ref([])
  const activeUid = ref<string | null>(null)
  const viewRefs = new Map<string, AvatarView>()

  const activeAvatar = computed(
    () => avatars.value.find(a => a.uid === activeUid.value) ?? null,
  )
  const activeController = computed<AvatarController | null>(
    () => activeAvatar.value?.view?.controller ?? null,
  )

  function patch(uid: string, values: Partial<AvatarInstance>) {
    avatars.value = avatars.value.map(a => (a.uid === uid ? { ...a, ...values } : a))
  }

  function setActiveUid(uid: string | null) {
    activeUid.value = uid
  }

  async function loadAvatar(
    characterId: string,
    characterName: string,
    container: HTMLElement,
    onProgressCallback?: (progress: number) => void,
  ): Promise<string> {
    const uid = genUid()
    const inst: AvatarInstance = {
      uid,
      characterId,
      characterName,
      view: null,
      connectionState: 'disconnected' as ConnectionState,
      conversationState: 'idle' as ConversationState,
      animationState: null,
      stalled: false,
      rendered: false,
      fps: null,
      loading: true,
      loadProgress: 0,
      error: null,
    }
    avatars.value = [...avatars.value, inst]
    activeUid.value = uid

    try {
      const avatar = await AvatarManager.shared.load(characterId, (info) => {
        const p = info.progress ?? 0
        patch(uid, { loadProgress: p })
        onProgressCallback?.(p)
      })
      const view = new AvatarView(avatar, container)

      view.controller.onConnectionState = (state: ConnectionState) => {
        patch(uid, { connectionState: state })
      }
      view.controller.onConversationState = (state: ConversationState) => {
        patch(uid, { conversationState: state })
      }
      view.controller.onError = (err: Error) => {
        patch(uid, { error: err.message })
        onError?.(err.message)
      }

      // The rest are registered even though this demo does not act on them: the
      // status bar lists every public callback, and one that is never hooked up
      // would sit at its initial value looking broken.
      view.controller.onAnimationState = (type: AnimationType) => {
        patch(uid, { animationState: type })
      }
      view.controller.onPlaybackStall = (stalled: boolean) => {
        patch(uid, { stalled })
      }
      view.onFirstRendering = () => {
        patch(uid, { rendered: true })
      }
      // Off by default and free while off, so it is switched on here to give the
      // status bar something to report.
      view.controller.frameRateMonitorEnabled = true
      view.controller.onFrameRateInfo = (info) => {
        // `fps` is the measured render rate; `presentationFps` is what actually
        // reached the screen. Guarded because a window with no frames in it — a
        // hidden tab, the gap between rounds — averages to NaN.
        const fps = Number.isFinite(info.fps) ? Math.round(info.fps) : null
        patch(uid, { fps })
      }

      viewRefs.set(uid, view)
      patch(uid, { view, loading: false })
      return uid
    } catch (e: any) {
      patch(uid, { loading: false, error: e.message })
      throw e
    }
  }

  function removeAvatar(uid: string) {
    const view = viewRefs.get(uid)
    if (view) {
      view.controller.close()
      view.dispose()
      viewRefs.delete(uid)
    }
    avatars.value = avatars.value.filter(a => a.uid !== uid)
    if (activeUid.value === uid) {
      activeUid.value = [...viewRefs.keys()][0] ?? null
    }
  }

  function removeAll() {
    viewRefs.forEach(v => {
      v.controller.close()
      v.dispose()
    })
    viewRefs.clear()
    avatars.value = []
    activeUid.value = null
  }

  onUnmounted(() => {
    viewRefs.forEach(v => {
      v.controller.close()
      v.dispose()
    })
    viewRefs.clear()
  })

  return {
    avatars,
    activeUid,
    activeAvatar,
    activeController,
    setActiveUid,
    loadAvatar,
    removeAvatar,
    removeAll,
  }
}
