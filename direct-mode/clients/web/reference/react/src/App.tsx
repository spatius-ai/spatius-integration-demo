import { useState, useEffect, useCallback } from 'react'
import { AvatarSDK, DrivingServiceMode, LogLevel } from '@spatius/avatarkit'
import { fetchConfig, fetchSessionToken, type BackendConfig } from '@direct-core'
import Playground from './views/Playground'
import './App.css'

const MODE = DrivingServiceMode.direct

/**
 * Boot, then hand over to the playground.
 *
 * There is no configuration screen: everything the SDK needs — the App ID, the
 * region, the avatar — comes from the server's `/api/config`, and the Session Token
 * is minted there too. This is the whole of the credential path in a Direct Mode
 * app, and it is four lines.
 */
export default function App() {
  const [config, setConfig] = useState<BackendConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setError(null)
    ;(async () => {
      try {
        const backend = await fetchConfig()
        const session = await fetchSessionToken()
        await AvatarSDK.initialize(backend.appId, {
          // Omitting region entirely is what triggers the SDK's automatic pick, so `auto`
          // from the server is passed as an omission.
          ...(backend.region && backend.region !== 'auto' ? { region: backend.region } : {}),
          drivingServiceMode: MODE,
          audioFormat: { channelCount: 1, sampleRate: backend.sampleRate },
          logLevel: LogLevel.all,
        })
        AvatarSDK.setSessionToken(session.sessionToken)
        if (!cancelled) setConfig(backend)
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'Could not reach the Direct Mode server')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [attempt])

  const retry = useCallback(() => setAttempt(n => n + 1), [])

  if (error) {
    return (
      <div className="app boot">
        <div className="boot-error">
          <h1>Cannot start</h1>
          <p>{error}</p>
          <p className="boot-hint">
            Check that the Direct Mode server is running and that its <code>.env</code>{' '}
            is filled in.
          </p>
          <button className="primary" onClick={retry}>Retry</button>
        </div>
      </div>
    )
  }

  if (!config) {
    return (
      <div className="app boot">
        <div className="boot-status">Connecting to the Direct Mode server…</div>
      </div>
    )
  }

  return (
    <div className="app">
      <Playground config={config} />
    </div>
  )
}
