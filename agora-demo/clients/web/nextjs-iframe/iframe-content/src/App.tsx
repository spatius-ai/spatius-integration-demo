import { useState, useEffect, useCallback } from 'react'
import Room from './views/Room'
import { fetchConfig, type ServerConfig } from './utils/rtcSession'
import './App.css'

/**
 * Straight into the room.
 *
 * There is no configuration step: every setting this demo has — the Spatius and Agora
 * credentials, the conversation language, the voice — lives in the server's `.env`,
 * and the server refuses to start while one is missing. All this has to do first is
 * ask the server what the default avatar is, which also tells it the server is up.
 */
export default function App() {
  const [config, setConfig] = useState<ServerConfig | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setError(null)
    fetchConfig()
      .then(setConfig)
      .catch((e: any) => setError(e?.message ?? 'Cannot reach the demo server'))
  }, [])

  useEffect(load, [load])

  if (error) {
    return (
      <div className="app boot-error">
        <h1>Cannot reach the demo server</h1>
        <p>{error}</p>
        <p className="boot-hint">
          Start it with <code>uv run python server.py</code> in{' '}
          <code>servers/python</code>, then try again.
        </p>
        <button className="primary" onClick={load}>Retry</button>
      </div>
    )
  }

  if (!config) return <div className="app" />

  return (
    <div className="app">
      <Room config={config} />
    </div>
  )
}
