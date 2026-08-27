'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { MicrophonePcmCapture } from '@/utils/audioCapture'
import type { BackendClient } from '@/utils/backendClient'

interface Props {
  /** The one connection to the server; null until it has been opened. */
  client: BackendClient | null
  connected: boolean
  /**
   * Which language the conversation runs in, chosen on the config page.
   *
   * Not switchable here: recognition, synthesis and the persona are all fixed when
   * the agent session is built, so changing it means a new session.
   */
  language: string
  /** Creates the audio context, which a browser only allows inside a user gesture. */
  onBeforeStart: () => Promise<void>
  onNotify?: (text: string, kind?: 'error' | 'warning') => void
}

interface Turn {
  role: 'user' | 'assistant'
  text: string
}

const MIC_SAMPLE_RATE = 16000

/**
 * The realtime scene's controls: one microphone, in place of the clip button.
 *
 * Everything conversational happens on the server — the mic goes up as PCM, the
 * agent's reply is driven into the avatar there, and what comes back is the same
 * encoded audio + motion the pre-recorded scene produces.
 */
export default function RealtimePanel({ client, connected, language, onBeforeStart, onNotify }: Props) {
  const [agentReady, setAgentReady] = useState(false)
  const [starting, setStarting] = useState(false)
  const [micOn, setMicOn] = useState(false)
  /**
   * Whether the microphone has ever been opened in this session.
   *
   * Drives the green ring, which points at the mic once the avatar is connected
   * and stops for good after the first press — same as the character list and
   * Start. Not `!micOn`, or the ring would return on every mute, long after the
   * user has learned where the button is.
   */
  const [micUsed, setMicUsed] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [transcript, setTranscript] = useState<Turn[]>([])
  const [typed, setTyped] = useState('')
  const micRef = useRef<MicrophonePcmCapture | null>(null)

  // The client is created by ControlPanel once an avatar is loaded, so this panel
  // attaches its own handlers when it appears rather than at construction.
  // ControlPanel's own callbacks (errors, close) are left alone.
  useEffect(() => {
    if (!client) return
    client.callbacks.onSpeaking = () => setSpeaking(true)
    client.callbacks.onTranscript = (role, text) =>
      setTranscript(prev => [...prev, { role, text }])
    return () => {
      client.callbacks.onSpeaking = undefined
      client.callbacks.onTranscript = undefined
    }
  }, [client])

  // A dropped connection takes the agent with it.
  useEffect(() => {
    if (!connected) {
      setAgentReady(false)
      setMicOn(false)
      void micRef.current?.stop()
      micRef.current = null
    }
  }, [connected])

  useEffect(() => {
    return () => {
      void micRef.current?.stop()
      micRef.current = null
    }
  }, [])

  const ensureAgent = useCallback(async (): Promise<boolean> => {
    if (!client || !connected) {
      onNotify?.('Still connecting to the server — try again in a moment.', 'warning')
      return false
    }
    if (agentReady) return true

    // Brought up on the first press rather than on mount: it costs a model session,
    // and someone who only wants the pre-recorded scene should not pay for one by
    // loading the page.
    setStarting(true)
    try {
      await onBeforeStart()
      // Awaited rather than fired off: microphone audio pushed before the agent
      // exists is dropped, which presents as a mic that records nothing.
      await client.startAgent(language)
      setAgentReady(true)
      return true
    } catch (e: any) {
      onNotify?.(e?.message ?? 'The agent did not start')
      return false
    } finally {
      setStarting(false)
    }
  }, [client, connected, agentReady, language, onBeforeStart, onNotify])

  const toggleMic = useCallback(async () => {
    if (!(await ensureAgent())) return

    if (micOn) {
      await micRef.current?.stop()
      micRef.current = null
      setMicOn(false)
      return
    }

    try {
      const mic = new MicrophonePcmCapture(MIC_SAMPLE_RATE)
      micRef.current = mic
      await mic.start(chunk => {
        client?.pushMicAudio(chunk.buffer as ArrayBuffer)
      })
      setMicOn(true)
      setMicUsed(true)
    } catch (e: any) {
      micRef.current = null
      onNotify?.(
        e?.name === 'NotAllowedError'
          ? 'Microphone permission was denied.'
          : (e?.message ?? 'Could not open the microphone'),
      )
    }
  }, [ensureAgent, micOn, client, onNotify])

  const sendTyped = useCallback(async () => {
    const text = typed.trim()
    if (!text) return
    if (!(await ensureAgent())) return
    client?.say(text)
    setTyped('')
  }, [typed, ensureAgent, client])

  return (
    <div className="realtime-panel">
      <h4>
        Microphone
        {speaking && <span className="speaking-dot" title="The avatar is speaking" />}
      </h4>

      <button
        className={`mic-btn ${micOn ? 'on' : ''} ${connected && !micUsed ? 'needs-pick' : ''}`}
        disabled={!connected || starting}
        onClick={toggleMic}
        title={micOn ? 'Stop the microphone' : 'Start talking'}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3z" />
          <path d="M18 11a1 1 0 1 0-2 0 4 4 0 0 1-8 0 1 1 0 1 0-2 0 6 6 0 0 0 5 5.91V19H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-2.09A6 6 0 0 0 18 11z" />
        </svg>
      </button>

      <p className="mic-state">
        {!connected
          ? 'Connecting to the server…'
          : starting
            ? 'Starting the agent…'
            : micOn
              ? 'Listening — just talk, the agent decides when your turn ends.'
              : agentReady
                ? 'Microphone off.'
                : 'Tap to start talking.'}
      </p>

      {/* A way to try the scene without a microphone — a machine with no input
          device, or a quick check that the agent replies. */}
      <form
        className="realtime-text"
        onSubmit={e => {
          e.preventDefault()
          void sendTyped()
        }}
      >
        <input
          value={typed}
          onChange={e => setTyped(e.target.value)}
          placeholder="…or type a line to speak"
          disabled={!connected}
        />
        <button type="submit" className="secondary" disabled={!typed.trim() || !connected}>
          Say
        </button>
      </form>

      {transcript.length > 0 && (
        <div className="transcript">
          {transcript.map((turn, i) => (
            <p key={i} className={turn.role}>
              <strong>{turn.role === 'user' ? 'You' : 'Avatar'}</strong>
              {turn.text}
            </p>
          ))}
        </div>
      )}

      <p className="realtime-hint">
        The conversation runs on the server — ASR, LLM and TTS — and the reply is
        driven into the avatar there. This page only renders the audio and motion
        that come back.
      </p>
    </div>
  )
}
