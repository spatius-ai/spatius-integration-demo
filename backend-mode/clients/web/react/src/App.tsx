import { useState, useCallback } from 'react'
import { DrivingServiceMode } from '@spatius/avatarkit'
import Configuration from './views/Configuration'
import Playground from './views/Playground'
import './App.css'

/**
 * Which scene the playground opens in. Both are driven server-side and reach this
 * client as the same audio + motion messages — they differ only in where the audio
 * came from.
 */
export type Scene = 'sample' | 'realtime'

/** Which language the realtime conversation runs in. */
export type Lang = 'en' | 'zh'

export interface AppConfig {
  appId: string
  region: string
  scene: Scene
  /**
   * Recognition, synthesis and the agent's persona all follow this, and all three
   * are fixed when the agent session is built — which is why it is chosen here
   * rather than switched inside the scene.
   */
  language: Lang
  /** Only the realtime scene reaches an agent, so this is absent for the other. */
  livekit?: {
    url: string
    apiKey: string
    apiSecret: string
  }
}

const MODE = DrivingServiceMode.backend

export default function App() {
  const [step, setStep] = useState<1 | 2>(1)
  const [config, setConfig] = useState<AppConfig | null>(null)

  const handleInitialized = useCallback((c: AppConfig) => {
    setConfig(c)
    setStep(2)
  }, [])

  return (
    <div className="app">
      <div className={`view ${step === 1 ? 'active' : ''}`}>
        <Configuration
          mode={MODE}
          onInitialized={handleInitialized}
        />
      </div>
      <div className={`view ${step === 2 ? 'active' : ''}`}>
        {config && step === 2 && (
          <Playground mode={MODE} config={config} />
        )}
      </div>
    </div>
  )
}
