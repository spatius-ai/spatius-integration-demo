import { useState, useCallback } from 'react'
import Configuration from './views/Configuration'
import Room from './views/Room'
import './App.css'

/** Which language the conversation runs in. */
export type Lang = 'en' | 'zh'

export interface AppConfig {
  language: Lang
  avatarId: string
}

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null)

  const handleReady = useCallback((c: AppConfig) => setConfig(c), [])

  return (
    <div className="app">
      <div className={`view ${config ? '' : 'active'}`}>
        <Configuration onReady={handleReady} />
      </div>
      <div className={`view ${config ? 'active' : ''}`}>
        {config && <Room config={config} />}
      </div>
    </div>
  )
}
