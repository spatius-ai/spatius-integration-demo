'use client'

import { useState, useCallback } from 'react'
import { DrivingServiceMode } from '@spatius/avatarkit'
import Configuration from '@/views/Configuration'
import Playground from '@/views/Playground'
import type { AppConfig } from '@/types'

/**
 * The two-step flow, in its own component so the page can defer the whole thing
 * with `next/dynamic` — see app/page.tsx for why the SDK cannot be imported into
 * the server pass.
 */
const MODE = DrivingServiceMode.backend

export default function AvatarApp() {
  const [step, setStep] = useState<1 | 2>(1)
  const [config, setConfig] = useState<AppConfig | null>(null)

  const handleInitialized = useCallback((c: AppConfig) => {
    setConfig(c)
    setStep(2)
  }, [])

  return (
    <div className="app">
      <div className={`view ${step === 1 ? 'active' : ''}`}>
        <Configuration mode={MODE} onInitialized={handleInitialized} />
      </div>
      <div className={`view ${step === 2 ? 'active' : ''}`}>
        {config && step === 2 && <Playground mode={MODE} config={config} />}
      </div>
    </div>
  )
}
