import type { HTMLAttributes } from 'react'

import { useSpatiusAvatarContext } from './spatius-avatar-context'
import type { SpatiusAvatarConnectionStatus } from '../../types/spatius-avatar'
import { cn } from '../../utils'

const statusLabels: Record<SpatiusAvatarConnectionStatus, string> = {
  idle: 'Idle',
  initializing: 'Initializing',
  connecting: 'Connecting',
  connected: 'Connected',
  disconnecting: 'Disconnecting',
  error: 'Error',
}

const statusClasses: Record<SpatiusAvatarConnectionStatus, string> = {
  idle: 'bg-secondary text-secondary-foreground',
  initializing: 'bg-secondary text-secondary-foreground',
  connecting: 'bg-secondary text-secondary-foreground',
  connected: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
  disconnecting: 'bg-secondary text-secondary-foreground',
  error: 'bg-destructive/10 text-destructive',
}

export type SpatiusAvatarStatusProps = HTMLAttributes<HTMLDivElement>

export function SpatiusAvatarStatus({ className, ...props }: SpatiusAvatarStatusProps) {
  const { status } = useSpatiusAvatarContext()

  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-semibold tracking-wide shadow-sm',
        statusClasses[status],
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          'size-2 rounded-full',
          status === 'connected' ? 'bg-emerald-500' : status === 'error' ? 'bg-destructive' : 'bg-current/60',
        )}
      />
      <span>{statusLabels[status]}</span>
    </div>
  )
}
