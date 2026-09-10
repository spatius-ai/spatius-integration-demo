import { useState, useEffect, useCallback } from 'react'
import { AvatarSDK, DrivingServiceMode, LogLevel } from '@spatius/avatarkit'
import { fetchConfig, type BackendConfig } from './utils/backendClient'
import Playground from './views/Playground'
import './App.css'

const MODE = DrivingServiceMode.backend

/**
 * The whole boot path.
 *
 * There is nothing to ask the user: in Backend Mode the server holds the Motion
 * Server connection and every credential with it, so this client reads what it needs
 * to render — app id, region, sample rates, the avatar to open with — from
 * `/api/config` and initializes the SDK with it. No session token is involved; this
 * SDK instance only renders what arrives over the WebSocket.
 */
export default function App() {
  const [config, setConfig] = useState<BackendConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setError(null)
    fetchConfig()
      .then(async (c) => {
        await AvatarSDK.initialize(c.appId, {
          // The Web SDK picks its region when none is given, so `auto` is passed as an omission.
          ...(c.region && c.region !== 'auto' ? { region: c.region } : {}),
          drivingServiceMode: MODE,
          audioFormat: { channelCount: 1, sampleRate: c.inputSampleRate },
          logLevel: LogLevel.all,
        })
        if (!cancelled) setConfig(c)
      })
      .catch((e: any) => {
        if (!cancelled) setError(e?.message ?? 'Could not start')
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  const retry = useCallback(() => setAttempt(n => n + 1), [])

  if (error) {
    return (
      <div className="app boot-state">
        <div className="boot-box">
          <h1>Cannot reach the Backend Mode server</h1>
          <p className="boot-error">{error}</p>
          <p className="boot-hint">
            Start it with <code>cd servers/python &amp;&amp; uv run python -m app.main</code>.
            It reads every credential from its own <code>.env</code> and reports any
            that is missing.
          </p>
          <button className="primary" onClick={retry}>Retry</button>
        </div>
      </div>
    )
  }

  if (!config) {
    return (
      <div className="app boot-state">
        <div className="boot-box">
          <p className="boot-hint">Starting…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <Playground config={config} />
    </div>
  )
}
