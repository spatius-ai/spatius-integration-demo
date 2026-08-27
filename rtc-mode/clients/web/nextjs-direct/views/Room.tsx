'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import type { AppConfig } from '@/types'
import { RtcSession, stopSessionOnUnload } from '@/utils/rtcSession'
import CharacterList from '@/components/CharacterList'
import Toast from '@/components/Toast'
import { useToast } from '@/hooks/useToast'

interface Props {
  config: AppConfig
}

/**
 * The room, laid out like the other two modes: characters on the left, the avatar in
 * the middle, controls on the right.
 *
 * What differs is that there is nothing to send. In RTC Mode the avatar is in the
 * call, so the panel holds a microphone and nothing else: no clips to play, and no
 * pause or interrupt, because there is no local playback to act on.
 */
export default function Room({ config }: Props) {
  const stageRef = useRef<HTMLDivElement>(null)
  const sessionRef = useRef<RtcSession | null>(null)
  /** Pending teardown, cancelled if this remounts — see the effect below. */
  const teardownRef = useRef<number | null>(null)
  const { messages, push: notify, dismiss } = useToast()

  const [avatarId, setAvatarId] = useState<string | null>(null)
  const [characterName, setCharacterName] = useState('')
  const [status, setStatus] = useState('Pick a character to enter the room.')
  const [rendered, setRendered] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [micOn, setMicOn] = useState(false)
  /**
   * Whether the agent is in the room and listening.
   *
   * Distinct from `rendered`, which only says the avatar has been drawn — that
   * happens several seconds earlier. Gating the microphone on the wrong one of the
   * two let it be opened into an empty room: the button went live, nothing was
   * listening, and it took a second press once the agent finally arrived.
   */
  const [agentReady, setAgentReady] = useState(false)
  /**
   * Whether the microphone has ever been opened in this room.
   *
   * Drives the green ring, which points at the mic the moment it becomes usable and
   * stops for good once it has been pressed — same as the character list and Start.
   * Not `!micOn`, or the ring would come back every time the mic is muted, long
   * after the user has learned where it is.
   */
  const [micUsed, setMicUsed] = useState(false)

  const enter = useCallback(
    async (id: string, name: string) => {
      if (sessionRef.current || !stageRef.current) return
      // A teardown scheduled by the effect below would otherwise fire mid-way
      // through this and stop the session being built here.
      if (teardownRef.current !== null) {
        window.clearTimeout(teardownRef.current)
        teardownRef.current = null
      }
      setAvatarId(id)
      setCharacterName(name)
      setConnecting(true)

      const session = new RtcSession({
        onProgress: setStatus,
        onDownload: percent => setStatus(`Downloading avatar… ${percent}%`),
        onRendered: () => setRendered(true),
        onError: message => notify(message),
      })
      sessionRef.current = session

      // True once this session has been replaced or torn down. Every await below
      // checks it: React's development double-invoke stops the session mid-way
      // through this function, and the steps that follow would then run against a
      // disconnected one — reporting "Not connected. Please call connect() first."
      // at the user, about a session they never saw.
      const superseded = () => sessionRef.current !== session

      try {
        await session.start(stageRef.current, id, config.language)
        if (superseded()) return
        setStatus('Connecting the agent…')

        // Not awaited: the avatar is on screen and the panel is usable as soon as
        // the room is up, and the agent takes seconds longer to come round. Holding
        // `enter()` open until then left the right-hand panel empty for the whole
        // wait, so the room looked like it had failed to load.
        //
        // "The agent joined" is not the thing to wait for either — at join time its
        // session is still starting up and speech arriving then is dropped, which
        // presents as a room that connects but never answers. waitForAgent() waits
        // for the ready attribute the worker sets after that.
        void session.waitForAgent().then(joined => {
          if (superseded()) return
          if (!joined) {
            // Almost always the worker: it is a separate process, and if it failed
            // to start there is nothing in the room to talk to. Said plainly here
            // rather than letting the microphone fail with an SDK error later.
            notify('The agent did not join — check the server log for the worker.')
            setStatus('No agent in the room. The avatar cannot hear or answer you.')
            return
          }
          // The microphone is left to the button. Opening it here as well gave the
          // same action two entry points racing each other, and the browser wants a
          // user gesture for it anyway.
          setAgentReady(true)
          setStatus('Ready — tap the microphone to talk.')
        })
      } catch (e: any) {
        // A session torn down mid-flight throws on its way out; that is this
        // component being replaced, not something the user needs told.
        if (superseded()) return
        notify(e?.message ?? 'Could not enter the room')
        setStatus('Could not enter the room.')
        await session.stop()
        sessionRef.current = null
        setAvatarId(null)
      } finally {
        if (!superseded()) setConnecting(false)
      }
    },
    [config.language, notify],
  )

  /**
   * Sessions bill from the moment they are created, so leaving has to close the room
   * rather than waiting for its timeout to reap it.
   *
   * The teardown is deferred rather than immediate. React's development double-invoke
   * unmounts and remounts this effect straight away, and stopping the session in that
   * gap kills a connection that `enter()` — which is driven by a click, not by this
   * effect — is still in the middle of building. What follows is `publishMic()`
   * against a disconnected player: "Not connected. Please call connect() first."
   *
   * A real unmount never comes back, so the timer runs and the room closes. The
   * development remount cancels it on the way back in.
   */
  useEffect(() => {
    const onUnload = () => {
      const id = sessionRef.current?.id
      if (id) stopSessionOnUnload(id)
    }
    window.addEventListener('pagehide', onUnload)

    if (teardownRef.current !== null) {
      window.clearTimeout(teardownRef.current)
      teardownRef.current = null
    }

    return () => {
      window.removeEventListener('pagehide', onUnload)
      teardownRef.current = window.setTimeout(() => {
        void sessionRef.current?.stop()
        sessionRef.current = null
        teardownRef.current = null
      }, 100)
    }
  }, [])

  const toggleMic = useCallback(async () => {
    const session = sessionRef.current
    // agentReady as well as the disabled attribute: opening the microphone into a
    // room with nothing listening is the failure this ordering exists to prevent,
    // and a guard in the handler holds even if the button is reached another way.
    if (!session || !agentReady) return
    try {
      // Asked of the session rather than read from `micOn`: the two can drift, and
      // acting on the stale one means publishing an already-open microphone, which
      // the SDK rejects.
      if (session.micActive) {
        await session.unpublishMic()
        setMicOn(false)
        setStatus('Microphone closed — the avatar cannot hear you.')
      } else {
        await session.publishMic()
        setMicOn(true)
        setMicUsed(true)
        setStatus('Just talk — the agent decides when your turn ends.')
      }
    } catch (e: any) {
      notify(e?.message ?? 'Could not switch the microphone')
    }
  }, [agentReady, notify])

  return (
    <div className="playground">
      <div className="playground-left">
        <CharacterList
          loadingId={connecting ? avatarId : null}
          loadProgress={0}
          onSelect={(id, name) => void enter(id, name)}
          empty={!avatarId}
        />
      </div>

      <div className="playground-center">
        <div className="center-header">
          <span className="avatar-count">{characterName || 'RTC Mode'}</span>
        </div>

        <div className="canvas-stage">
          <div className="avatar-canvas grid-1">
            <div className="canvas-cell active-cell">
              <div ref={stageRef} className="canvas-container" />
              {!avatarId && (
                <div className="canvas-empty">Select a character to get started</div>
              )}
              {avatarId && !rendered && <div className="canvas-loading">{status}</div>}
            </div>
          </div>

          {/* Nothing over the avatar here. The other two modes put pause and
              interrupt there because they drive playback; in RTC Mode the avatar is
              in the call and there is no local playback to act on — closing the
              microphone is the only control, and it lives in the panel. */}
        </div>
      </div>

      <div className="playground-right">
        <div className="control-panel">
          <h3>Controls</h3>

          {/* No status bar here. The other two modes list the SDK callbacks that
              report on driving the avatar; in RTC Mode nothing is driven from this
              page — the avatar is in the call — so there is nothing to report. */}

          {/* Shown as soon as the avatar is on screen, not once the agent is ready:
              the agent takes seconds longer, and an empty panel for that whole time
              read as a room that had failed to load. The button is here but inert
              until there is something in the room to hear it. */}
          {rendered ? (
            <div className="realtime-panel">
              <h4>Microphone</h4>

              <button
                className={`mic-btn ${micOn ? 'on' : ''} ${
                  agentReady && !micUsed ? 'needs-pick' : ''
                }`}
                onClick={() => void toggleMic()}
                disabled={!agentReady}
                title={
                  !agentReady
                    ? 'Waiting for the agent to join'
                    : micOn
                      ? 'Mute the microphone'
                      : 'Unmute the microphone'
                }
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3z" />
                  <path d="M18 11a1 1 0 1 0-2 0 4 4 0 0 1-8 0 1 1 0 1 0-2 0 6 6 0 0 0 5 5.91V19H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-2.09A6 6 0 0 0 18 11z" />
                </svg>
              </button>

              <p className="mic-state">{status}</p>
            </div>
          ) : (
            <p className="status">{status}</p>
          )}

          <p className="realtime-hint">
            RTC Mode is the one path where the avatar joins the call itself: audio
            travels on an RTC track and the motion rides along encoded in the video
            stream. Nothing is driven from this page, and nothing streams through the
            server — it only issues the credentials to join.
          </p>
        </div>
      </div>

      <Toast messages={messages} onDismiss={dismiss} />
    </div>
  )
}
