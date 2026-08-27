import type { DrivingServiceMode, LoadProgressInfo, LogLevel as AvatarSdkLogLevel } from '@spatius/avatarkit'
import type { AvatarPlayerOptions } from '@spatius/avatarkit-rtc'
import type { UseSessionReturn } from '@livekit/components-react'
import type { Room, Track } from 'livekit-client'

export type SpatiusAvatarConnectionStatus =
  | 'idle'
  | 'initializing'
  | 'connecting'
  | 'connected'
  | 'disconnecting'
  | 'error'

export interface SpatiusAvatarConnection {
  roomName: string
  token: string
  url: string
}

interface SpatiusAvatarSdkOptions {
  appId: string
  avatarId: string
  characterApiBaseUrl?: string
  drivingServiceMode?: DrivingServiceMode
  region?: string
  sessionToken?: string
  sdkLogLevel?: AvatarSdkLogLevel
  userId?: string
}

export interface UseSpatiusAvatarOptions extends SpatiusAvatarSdkOptions {
  connection: SpatiusAvatarConnection
  enabled?: boolean
  onAvatarError?: (error: Error) => void
  onConnected?: (room: Room | null) => void
  onDisconnected?: () => void
  onLoadProgress?: (progress: LoadProgressInfo) => void
  onStateChange?: (status: SpatiusAvatarConnectionStatus) => void
  playerOptions?: AvatarPlayerOptions
  publishMicrophone?: boolean
}

export interface SpatiusAvatarState {
  downloadProgress: number | null
  error: Error | null
  isConnected: boolean
  isLoading: boolean
  isPublishingMicrophone: boolean
  micTrack: Track | undefined
  room: Room | null
  status: SpatiusAvatarConnectionStatus
}

export interface UseSpatiusAvatarResult extends SpatiusAvatarState {
  connection: SpatiusAvatarConnection
  containerRef: (node: HTMLDivElement | null) => void
  disconnect: () => Promise<void>
  reconnect: () => Promise<void>
  session: UseSessionReturn
  startPublishingMicrophone: () => Promise<void>
  stopPublishingMicrophone: () => Promise<void>
}

export interface UseSpatiusAvatarSessionOptions {
  onDisconnect?: () => void
}
