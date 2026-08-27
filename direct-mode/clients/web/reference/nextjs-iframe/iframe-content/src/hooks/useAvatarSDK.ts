import { useState, useCallback, useRef, useEffect } from 'react'
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
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  const [avatars, setAvatars] = useState<AvatarInstance[]>([])
  const [activeUid, setActiveUid] = useState<string | null>(null)
  const viewRefs = useRef<Map<string, AvatarView>>(new Map())

  const activeAvatar = avatars.find(a => a.uid === activeUid) ?? null
  const activeController: AvatarController | null = activeAvatar?.view?.controller ?? null

  const updateAvatar = useCallback((uid: string, patch: Partial<AvatarInstance>) => {
    setAvatars(prev => prev.map(a => a.uid === uid ? { ...a, ...patch } : a))
  }, [])

  const loadAvatar = useCallback(async (
    characterId: string,
    characterName: string,
    container: HTMLElement,
    onProgressCallback?: (progress: number) => void,
  ): Promise<string> => {
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
    setAvatars(prev => [...prev, inst])
    setActiveUid(uid)

    try {
      const avatar = await AvatarManager.shared.load(characterId, (info) => {
        const p = info.progress ?? 0
        setAvatars(prev => prev.map(a =>
          a.uid === uid ? { ...a, loadProgress: p } : a
        ))
        onProgressCallback?.(p)
      })
      const view = new AvatarView(avatar, container)

      view.controller.onConnectionState = (state: ConnectionState) => {
        setAvatars(prev => prev.map(a => a.uid === uid ? { ...a, connectionState: state } : a))
      }
      view.controller.onConversationState = (state: ConversationState) => {
        setAvatars(prev => prev.map(a => a.uid === uid ? { ...a, conversationState: state } : a))
      }
      view.controller.onError = (err: Error) => {
        setAvatars(prev => prev.map(a => a.uid === uid ? { ...a, error: err.message } : a))
        onErrorRef.current?.(err.message)
      }

      // The rest are registered even though this demo does not act on them: the
      // status bar lists every public callback, and one that is never hooked up
      // would sit at its initial value looking broken.
      view.controller.onAnimationState = (type: AnimationType) => {
        setAvatars(prev => prev.map(a => a.uid === uid ? { ...a, animationState: type } : a))
      }
      view.controller.onPlaybackStall = (stalled: boolean) => {
        setAvatars(prev => prev.map(a => a.uid === uid ? { ...a, stalled } : a))
      }
      view.onFirstRendering = () => {
        setAvatars(prev => prev.map(a => a.uid === uid ? { ...a, rendered: true } : a))
      }
      // Off by default and free while off, so it is switched on here to give the
      // status bar something to report.
      view.controller.frameRateMonitorEnabled = true
      view.controller.onFrameRateInfo = (info) => {
        // `fps` is the measured render rate; `presentationFps` is what actually
        // reached the screen. Guarded because a window with no frames in it — a
        // hidden tab, the gap between rounds — averages to NaN.
        const fps = Number.isFinite(info.fps) ? Math.round(info.fps) : null
        setAvatars(prev => prev.map(a => a.uid === uid ? { ...a, fps } : a))
      }

      viewRefs.current.set(uid, view)
      setAvatars(prev => prev.map(a => a.uid === uid ? { ...a, view, loading: false } : a))
      return uid
    } catch (e: any) {
      setAvatars(prev => prev.map(a =>
        a.uid === uid ? { ...a, loading: false, error: e.message } : a
      ))
      throw e
    }
  }, [])

  const removeAvatar = useCallback((uid: string) => {
    const view = viewRefs.current.get(uid)
    if (view) {
      view.controller.close()
      view.dispose()
      viewRefs.current.delete(uid)
    }
    setAvatars(prev => {
      const next = prev.filter(a => a.uid !== uid)
      return next
    })
    setActiveUid(prev => {
      if (prev === uid) {
        const remaining = [...viewRefs.current.keys()]
        return remaining[0] ?? null
      }
      return prev
    })
  }, [])

  const removeAll = useCallback(() => {
    viewRefs.current.forEach(v => { v.controller.close(); v.dispose() })
    viewRefs.current.clear()
    setAvatars([])
    setActiveUid(null)
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      viewRefs.current.forEach(v => { v.controller.close(); v.dispose() })
      viewRefs.current.clear()
    }
  }, [])

  return {
    avatars,
    activeUid,
    activeAvatar,
    activeController,
    setActiveUid,
    loadAvatar,
    removeAvatar,
    removeAll,
    updateAvatar,
  }
}
