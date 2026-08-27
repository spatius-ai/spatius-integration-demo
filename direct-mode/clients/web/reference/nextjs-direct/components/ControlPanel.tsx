'use client'

import { useState, useCallback, useEffect } from 'react'
import type { MutableRefObject } from 'react'
import type { AvatarController } from '@spatius/avatarkit'
import type { AvatarInstance } from '@/hooks/useAvatarSDK'
import type { Scene } from '@/types'
import RealtimePanel from '@/components/RealtimePanel'
import { PCM_ASSETS, AUDIO_SOURCE_HINT } from '@/data/audioAssets'
import { loadPcmFile, sendPcmChunks } from '@/utils/audio'

interface AvatarSlot {
  uid: string
  index: number
  name: string
}

/**
 * The SDK callbacks worth watching, in the order they first fire over a session's
 * life: load, first frame, connect, then the per-turn ones.
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
    help: 'Fires once, when the avatar has actually been drawn. This — not "connected" — is the moment to take a loading overlay down.',
    read: a => (a.rendered ? 'rendered' : 'waiting'),
  },
  {
    key: 'connection',
    label: 'Connection',
    callback: 'AvatarController.onConnectionState',
    help: 'The Motion Server connection: disconnected → connecting → connected, or failed. Audio sent before connected is dropped.',
    read: a => a.connectionState,
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
    help: 'SDK failures — an expired session token, an unrecognised avatar id, a lost connection. Worth surfacing rather than leaving to the console.',
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
  /** Where to register the stop-sending callback, so the on-stage controls can
   *  interrupt a clip this panel started. */
  cancelSendRef: MutableRefObject<(() => void) | null>
  /** Which scene is open — it decides what drives the avatar below the status bar. */
  scene: Scene
  /** The realtime scene's conversation language, chosen on the config page. */
  language: string
}

export default function ControlPanel({ activeAvatar, activeController, multiMode, avatarSlots, activeUid, onSlotSelect, onNotify, cancelSendRef, scene, language }: Props) {
  // Track which clip is playing, not just that one is: swapping every button's
  // label at once resizes them and reflows the panel, which stutters the canvas.
  const [sendingPath, setSendingPath] = useState<string | null>(null)
  const sending = sendingPath !== null

  const connected = activeAvatar?.connectionState === 'connected'
  // Note the first clause: with no avatar at all, `activeAvatar?.view` is undefined
  // rather than null, so a `!== null` test passes and every control below turns on
  // before there is anything to control.
  const hasAvatar = !!activeAvatar?.view && !activeAvatar.loading

  const handleStart = useCallback(async () => {
    if (!activeController) return
    try {
      await (activeController as any).initializeAudioContext()
      await activeController.start()
    } catch (e: any) {
      console.error('Start failed:', e)
      onNotify?.(`Failed to connect: ${e?.message ?? e}`)
    }
  }, [activeController, onNotify])

  const handleSendPcm = useCallback(async (path: string) => {
    // Direct Mode has no session until start() runs, so audio sent now would be
    // dropped silently. Say so instead of leaving a dead button.
    if (!connected) {
      onNotify?.('Please click Start to connect before sending audio.', 'warning')
      return
    }
    if (!activeController || sending) return
    setSendingPath(path)
    try {
      // The audio context is already warmed up by handleStart; doing it here
      // again stalls the first frames of playback.
      const data = await loadPcmFile(path)
      // Wrapped so interrupting from the stage controls also clears this panel's
      // "sending" state — otherwise the clip stops but its button stays on '...'.
      const stop = sendPcmChunks(
        data,
        (chunk, end) => activeController.send(chunk.buffer as ArrayBuffer, end),
        () => setSendingPath(null),
      )
      cancelSendRef.current = () => {
        stop()
        setSendingPath(null)
      }
    } catch (e: any) {
      console.error('Send failed:', e)
      onNotify?.(`Failed to send audio: ${e?.message ?? e}`)
      setSendingPath(null)
    }
  }, [activeController, sending, connected, onNotify, cancelSendRef])

  useEffect(() => {
    if (!connected && cancelSendRef.current) {
      cancelSendRef.current()
      cancelSendRef.current = null
    }
  }, [connected, cancelSendRef])

  return (
    <div className="control-panel">
      <h3>Controls</h3>

      {/* Above the status bar: connecting is the first thing to do once a character
          is loaded, and the status below is what reports whether it worked.

          Pulsed until it is pressed, for the same reason the character list is:
          with an avatar on screen but no session, sending audio silently does
          nothing, which reads as a broken demo rather than a missing step.

          Only ever one pulse at a time — the whole point is to say which single
          thing to do next, and this button renders only once a character is
          loaded, by which time the list has stopped. */}
      {hasAvatar && (
        <button
          className={`primary full-width ${connected ? '' : 'needs-pick'}`}
          disabled={connected}
          onClick={handleStart}
        >
          {connected ? 'Connected' : 'Start'}
        </button>
      )}

      {activeAvatar && (
        <div className="status-bar">
          {STATUS_ROWS.map(row => {
            const value = row.read(activeAvatar)
            return (
              <div className={`status-row ${row.key === 'error' && value ? 'error' : ''}`} key={row.key}>
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
                  className={`status-value ${row.key === 'connection' ? activeAvatar.connectionState : ''} ${row.key === 'error' && value ? 'error-text' : ''} ${value === null ? 'status-idle' : ''}`}
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

      {!hasAvatar && (
        <p className="panel-hint">Load a character first</p>
      )}

      {/* What drives the avatar, and the only thing that differs between the two
          scenes: a list of clips to send, or a microphone whose replies come back
          from the agent. Both end at controller.send(). */}
      {hasAvatar && scene === 'realtime' && (
        <RealtimePanel
          controller={activeController}
          connected={connected}
          language={language}
          onNotify={onNotify}
        />
      )}

      {hasAvatar && scene !== 'realtime' && (
        <div className="audio-list">
          <h4>
            Audio Files
            <span className="audio-hint" title={AUDIO_SOURCE_HINT}>?</span>
          </h4>
          {PCM_ASSETS.map(a => (
            <button
              key={a.path}
              className="secondary full-width audio-btn"
              disabled={sending}
              onClick={() => handleSendPcm(a.path)}
            >
              {sendingPath === a.path ? '...' : `▶ ${a.name}`}
            </button>
          ))}
        </div>
      )}

      {/* Pause / resume / interrupt live over the avatar itself — they act on
          what is on screen, and only the ones that would do something show. */}
    </div>
  )
}
