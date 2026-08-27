'use client'

import { useCallback, useMemo, type ReactNode } from 'react'

import { RoomAudioRenderer, SessionProvider } from '@livekit/components-react'

import { useSpatiusAvatar } from '../../hooks/useSpatiusAvatar'
import type {
  UseSpatiusAvatarOptions,
  UseSpatiusAvatarSessionOptions,
} from '../../types/spatius-avatar'
import { SpatiusAvatarContext } from './spatius-avatar-context'

export interface SpatiusAvatarProviderProps
  extends UseSpatiusAvatarOptions,
    UseSpatiusAvatarSessionOptions {
  children: ReactNode
  muted?: boolean
  volume?: number
}

export function SpatiusAvatarProvider({
  children,
  muted,
  onDisconnect,
  volume,
  ...options
}: SpatiusAvatarProviderProps) {
  const avatar = useSpatiusAvatar(options)
  const end = useCallback(async () => {
    try {
      await avatar.disconnect()
    } finally {
      onDisconnect?.()
    }
  }, [avatar, onDisconnect])

  const session = useMemo(
    () => ({
      ...avatar.session,
      end,
    }),
    [avatar.session, end],
  )

  const value = useMemo(
    () => ({
      ...avatar,
      session,
    }),
    [avatar, session],
  )

  return (
    <SpatiusAvatarContext.Provider value={value}>
      <SessionProvider session={session}>
        <RoomAudioRenderer room={session.room} muted={muted} volume={volume} />
        {children}
      </SessionProvider>
    </SpatiusAvatarContext.Provider>
  )
}
