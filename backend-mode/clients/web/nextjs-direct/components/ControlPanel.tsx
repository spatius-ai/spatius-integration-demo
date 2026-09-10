'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import type { AvatarController } from '@spatius/avatarkit'
import type { AvatarInstance } from '@/hooks/useAvatarSDK'
import RealtimePanel from '@/components/RealtimePanel'
import { BackendClient } from '@/utils/backendClient'

interface AvatarSlot {
  uid: string
  index: number
  name: string
}

/**
 * The SDK callbacks worth watching, in the order they first fire over a session's
 * life: load, first frame, then the per-turn ones.
 *
 * Listed whether or not this demo acts on the value — which hooks exist is part of
 * what a reference client is meant to show, and a row that only appears once it has
 * fired is a row nobody knows to expect. A value of `—` means "registered, nothing
 * reported yet".
 *
 * Two public callbacks are deliberately absent, since a row that can only ever read
 * "ok" teaches nothing:
 *   onPlaybackStall   only fires under FrameStarvationMode.strictSync, and the
 *                     default mode lets audio keep playing through starvation
 *   onAnimationState  reports the animation library, which is not public yet
 * Both are still registered in useAvatarSDK, so wiring a row back on is one entry.
 */
const STATUS_ROWS: {
  key: string
  label: string
  callback: string
  help: string
  read: (a: AvatarInstance) => string | null
}[] = [
  {
    key: 'download',
    label: 'Download',
    callback: 'AvatarManager.load(id, onProgress)',
    help: 'Model download progress, 0-100%. Only fires on a cache miss — a second load of the same avatar resolves straight away.',
    read: a => (a.loading ? `${Math.round(a.loadProgress * 100)}%` : 'complete'),
  },
  {
    key: 'rendered',
    label: 'First frame',
    callback: 'AvatarView.onFirstRendering',
    help: 'Fires once, when the avatar has actually been drawn. This is the moment to take a loading overlay down.',
    read: a => (a.rendered ? 'rendered' : 'waiting'),
  },
  {
    key: 'conversation',
    label: 'Conversation',
    callback: 'AvatarController.onConversationState',
    help: 'Playback state: idle, playing or paused. The controls over the avatar follow this.',
    read: a => a.conversationState,
  },
  {
    key: 'fps',
    label: 'Frame rate',
    callback: 'AvatarController.onFrameRateInfo',
    help: 'Rolling render rate over a 2-second window. Off by default and free while off; this demo enables it via frameRateMonitorEnabled.',
    read: a => (a.fps === null ? null : `${a.fps} fps`),
  },
  {
    key: 'error',
    label: 'Error',
    callback: 'AvatarController.onError',
    help: 'SDK failures — a malformed frame, a rendering problem. Worth surfacing rather than leaving to the console.',
    read: a => a.error ?? 'none',
  },
]

interface Props {
  activeAvatar: AvatarInstance | null
  activeController: AvatarController | null
  multiMode?: boolean
  avatarSlots?: AvatarSlot[]
  activeUid?: string | null
  onSlotSelect?: (uid: string) => void
  onNotify?: (text: string, kind?: 'error' | 'warning') => void
}

export default function ControlPanel({
  activeAvatar,
  activeController,
  multiMode,
  avatarSlots,
  activeUid,
  onSlotSelect,
  onNotify,
}: Props) {
  const [connected, setConnected] = useState(false)
  /**
   * The client, as state rather than only a ref.
   *
   * The panels below receive it as a prop, and a ref does not re-render: passing
   * `clientRef.current` hands them whatever it was on first render — null — until
   * some other state change happens to refresh them. Pressing the microphone in
   * that window looks like a connection that never happened.
   */
  const [client, setClient] = useState<BackendClient | null>(null)
  const clientRef = useRef<BackendClient | null>(null)

  const hasAvatar = !!activeAvatar?.view && !activeAvatar.loading

  // The controller changes when a different character is selected, and the client
  // outlives that — so it is handed the current one rather than closing over it.
  useEffect(() => {
    clientRef.current?.setController(activeController)
  }, [activeController])

  /**
   * Open the connection as soon as there is an avatar to render into.
   *
   * Nothing to ask the user here: in Backend Mode this is a WebSocket to the demo's
   * own server, not a session that costs anything, and every control below is dead
   * until it exists. Direct Mode has a Start button because there the client opens
   * the Motion Server connection itself.
   */
  useEffect(() => {
    if (!hasAvatar || !activeController || clientRef.current) return

    let cancelled = false
    const client = new BackendClient({
      onError: (message) => onNotify?.(message),
      onClosed: () => {
        setConnected(false)
        clientRef.current = null
        setClient(null)
      },
    })
    client.setController(activeController)
    clientRef.current = client

    client
      .connect()
      .then(() => {
        if (cancelled) return
        if (activeAvatar?.characterId) client.setAvatar(activeAvatar.characterId)
        setClient(client)
        setConnected(true)
      })
      .catch((e) => {
        if (cancelled) return
        onNotify?.(e?.message ?? 'Could not reach the Backend Mode server')
        clientRef.current = null
        setClient(null)
      })

    return () => {
      cancelled = true
    }
    // activeAvatar.characterId is deliberately absent: switching character should
    // send set_avatar (the effect below), not tear the connection down.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAvatar, activeController, onNotify])

  /**
   * The audio context has to be created inside a user gesture — a browser will not
   * allow it otherwise, and the avatar then renders in silence with nothing
   * reported. So it is done on the first press of the microphone, rather than
   * needing a button of its own.
   */
  const ensureAudioContext = useCallback(async () => {
    await activeController?.initializeAudioContext()
  }, [activeController])

  // Which avatar the server should drive, kept in step with what is on screen.
  useEffect(() => {
    if (connected && activeAvatar?.characterId) {
      clientRef.current?.setAvatar(activeAvatar.characterId)
    }
  }, [connected, activeAvatar?.characterId])

  useEffect(() => {
    return () => {
      clientRef.current?.close()
      clientRef.current = null
    }
  }, [])

  return (
    <div className="control-panel">
      <h3>Controls</h3>

      {activeAvatar && (
        <div className="status-bar">
          {STATUS_ROWS.map(row => {
            const value = row.read(activeAvatar)
            return (
              <div className={`status-row ${row.key === 'error' && value && value !== 'none' ? 'error' : ''}`} key={row.key}>
                <span className="status-label">
                  {row.label}
                  <span className="status-help" tabIndex={0}>
                    ?
                    <span className="status-tip" role="tooltip">
                      <code>{row.callback}</code>
                      <span>{row.help}</span>
                    </span>
                  </span>
                </span>
                <span
                  className={`status-value ${row.key === 'error' && value && value !== 'none' ? 'error-text' : ''} ${value === null ? 'status-idle' : ''}`}
                >
                  {value ?? '—'}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {multiMode && avatarSlots && avatarSlots.length > 0 && (
        <div className="slot-selector">
          <h4>Active Avatar</h4>
          <div className="slot-list">
            {avatarSlots.map(s => (
              <button
                key={s.uid}
                className={`slot-btn ${s.uid === activeUid ? 'active' : ''}`}
                onClick={() => onSlotSelect?.(s.uid)}
              >
                <span className="slot-index">{s.index}</span>
                <span className="slot-name">{s.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {!hasAvatar && <p className="panel-hint">Load a character first</p>}

      {/* What drives the avatar. The conversation runs server-side and arrives
          here as encoded audio + motion messages. */}
      {hasAvatar && (
        <RealtimePanel
          client={client}
          connected={connected}
          onBeforeStart={ensureAudioContext}
          onNotify={onNotify}
        />
      )}
    </div>
  )
}
