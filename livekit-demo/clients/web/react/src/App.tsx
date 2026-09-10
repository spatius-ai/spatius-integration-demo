import { useState, useEffect } from 'react'
import Room from './views/Room'
import { fetchConfig, initializeSdk } from './utils/rtcSession'
import './App.css'

/**
 * The app boots straight into the room.
 *
 * There is no configuration step: every credential and every setting — language,
 * voice, model — lives in the server's `.env`, and the server refuses to start
 * without them. All this page needs is the App ID to initialize the SDK with, which
 * it fetches on mount; the only thing the user chooses is a character.
 */
export default function App() {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Bumped by Retry to re-run the effect below. */
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setError(null)
    fetchConfig()
      .then(async config => {
        // Initialized here rather than at the first click: the SDK reads the App ID
        // only at initialize time, and doing it once on the way in keeps the first
        // character selection from paying for it.
        await initializeSdk(config.appId)
        if (!cancelled) setReady(true)
      })
      .catch((e: any) => {
        if (!cancelled) setError(e?.message ?? 'Could not reach the demo server')
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  if (error) {
    return (
      <div className="app boot-error">
        <div className="boot-error-box">
          <h1>Cannot start</h1>
          <p>{error}</p>
          <p className="boot-error-hint">
            Start the demo server (<code>servers/python</code>) and check its terminal:
            it prints any key still missing from <code>.env</code> and exits.
          </p>
          <button className="primary" onClick={() => setAttempt(n => n + 1)}>
            Retry
          </button>
        </div>
      </div>
    )
  }

  return <div className="app">{ready && <Room />}</div>
}
