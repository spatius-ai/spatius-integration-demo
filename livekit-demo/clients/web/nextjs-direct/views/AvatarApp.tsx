'use client'

import { useState, useCallback } from 'react'
import Configuration from '@/views/Configuration'
import Room from '@/views/Room'
import type { AppConfig } from '@/types'

/**
 * The two-step flow, in its own component so the page can defer the whole thing
 * with `next/dynamic` — see app/page.tsx for why the SDK cannot be imported into
 * the server pass.
 */
export default function AvatarApp() {
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
