import { useState, useRef, useCallback, useEffect } from 'react'
import type { AvatarController } from '@spatius/avatarkit'
import { RealtimeClient, fetchRealtimeUrl } from '../utils/realtimeClient'

interface Props {
  controller: AvatarController | null
  /** No session yet, so there is nowhere for a reply to go. */
  connected: boolean
  /**
   * Which language the conversation runs in, chosen on the config page.
   *
   * Not switchable here: recognition, synthesis and the persona are all fixed when
   * the agent session is built, so changing it means a new session — which is what
   * going back to the config page does anyway.
   */
  language: string
  onNotify?: (text: string, kind?: 'error' | 'warning') => void
}

interface Turn {
  role: 'user' | 'assistant'
  text: string
}


/**
 * The realtime scene's controls: one microphone, in place of the clip list.
 *
 * Everything conversational happens on the backend — the mic goes up as PCM, the
 * agent's speech comes back the same way, and this hands it to the same
 * `controller.send()` the pre-recorded scene uses.
 */
export default function RealtimePanel({ controller, connected, language, onNotify }: Props) {
  const [agentReady, setAgentReady] = useState(false)
  const [connecting, setConnecting] = useState(false)
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

  const clientRef = useRef<RealtimeClient | null>(null)
  // Kept in a ref as well: the client is built once, and a callback closing over
  // the controller from that render would keep sending to a stale one.
  const controllerRef = useRef(controller)
  controllerRef.current = controller

  const connectAgent = useCallback(async () => {
    if (clientRef.current || connecting) return
    setConnecting(true)
    try {
      const url = await fetchRealtimeUrl()
      const client = new RealtimeClient(
        {
          send: (pcm, end) => controllerRef.current?.send(pcm, end),
          interrupt: () => controllerRef.current?.interrupt(),
        },
        {
          onSpeaking: () => setSpeaking(true),
          onTurnEnd: () => setSpeaking(false),
          onTranscript: (role, text) => setTranscript(prev => [...prev, { role, text }]),
          onError: (message) => onNotify?.(message),
          onClosed: () => {
            setAgentReady(false)
            setMicOn(false)
          },
        },
      )
      clientRef.current = client
      await client.connect(url, language)
      setAgentReady(true)
    } catch (e: any) {
      onNotify?.(e?.message ?? 'Could not reach the agent')
      await clientRef.current?.close()
      clientRef.current = null
    } finally {
      setConnecting(false)
    }
  }, [connecting, language, onNotify])

  const toggleMic = useCallback(async () => {
    if (!connected) {
      onNotify?.('Click Start to connect the avatar first.', 'warning')
      return
    }
    // The agent is brought up on the first press rather than on mount: it costs a
    // model session, and someone who only wants the pre-recorded scene should not
    // pay for one by loading the page.
    if (!clientRef.current) {
      await connectAgent()
      if (!clientRef.current) return
    }

    const client = clientRef.current
    if (micOn) {
      await client.stopMic()
      setMicOn(false)
    } else {
      try {
        await client.startMic()
        setMicOn(true)
        setMicUsed(true)
      } catch (e: any) {
        onNotify?.(
          e?.name === 'NotAllowedError'
            ? 'Microphone permission was denied.'
            : (e?.message ?? 'Could not open the microphone'),
        )
      }
    }
  }, [connected, micOn, connectAgent, onNotify])

  const sendTyped = useCallback(async () => {
    const text = typed.trim()
    if (!text) return
    if (!connected) {
      onNotify?.('Click Start to connect the avatar first.', 'warning')
      return
    }
    if (!clientRef.current) {
      await connectAgent()
      if (!clientRef.current) return
    }
    clientRef.current.say(text)
    setTyped('')
  }, [typed, connected, connectAgent, onNotify])

  // Close the agent when the avatar's session goes away, so a dropped connection
  // does not leave a model session running with nowhere to send its audio.
  useEffect(() => {
    if (!connected && clientRef.current) {
      void clientRef.current.close()
      clientRef.current = null
      setAgentReady(false)
      setMicOn(false)
    }
  }, [connected])

  useEffect(() => {
    return () => {
      void clientRef.current?.close()
      clientRef.current = null
    }
  }, [])

  return (
    <div className="realtime-panel">
      <h4>
        Microphone
        {speaking && <span className="speaking-dot" title="The avatar is speaking" />}
      </h4>

      <button
        className={`mic-btn ${micOn ? 'on' : ''} ${connected && !micUsed ? 'needs-pick' : ''}`}
        disabled={connecting}
        onClick={toggleMic}
        title={micOn ? 'Stop the microphone' : 'Start talking'}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3z" />
          <path d="M18 11a1 1 0 1 0-2 0 4 4 0 0 1-8 0 1 1 0 1 0-2 0 6 6 0 0 0 5 5.91V19H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-2.09A6 6 0 0 0 18 11z" />
        </svg>
      </button>

      <p className="mic-state">
        {connecting
          ? 'Starting the agent…'
          : micOn
            ? 'Listening — just talk, the agent decides when your turn ends.'
            : agentReady
              ? 'Microphone off.'
              : 'Tap to start talking.'}
      </p>

      {/* A way to try the scene without a microphone — a headless browser, a
          machine with no input device, or a quick check that the agent replies. */}
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
        />
        <button type="submit" className="secondary" disabled={!typed.trim()}>
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
        The conversation runs on the backend — ASR, LLM and TTS — and its speech
        arrives here as PCM over a WebSocket. That audio goes to{' '}
        <code>controller.send()</code>, exactly like the pre-recorded clips do.
      </p>
    </div>
  )
}
