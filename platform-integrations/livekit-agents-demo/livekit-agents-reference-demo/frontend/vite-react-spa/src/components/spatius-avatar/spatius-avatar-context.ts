import { createContext, useContext } from 'react'

import type { UseSpatiusAvatarResult } from '../../types/spatius-avatar'

export const SpatiusAvatarContext = createContext<UseSpatiusAvatarResult | null>(null)

export function useSpatiusAvatarContext() {
  const context = useContext(SpatiusAvatarContext)

  if (!context) {
    throw new Error('useSpatiusAvatarContext must be used within SpatiusAvatarProvider.')
  }

  return context
}
