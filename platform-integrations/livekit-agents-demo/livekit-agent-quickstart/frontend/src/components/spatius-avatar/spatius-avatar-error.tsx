import type { HTMLAttributes, ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

import { useSpatiusAvatarContext } from '@/components/spatius-avatar/spatius-avatar-context'
import { cn } from '@/lib/utils'

export interface SpatiusAvatarErrorProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode
}

export function SpatiusAvatarError({ className, children, ...props }: SpatiusAvatarErrorProps) {
  const { error, status } = useSpatiusAvatarContext()

  if (status !== 'error' || !error) {
    return null
  }

  return (
    <div
      className={cn(
        'absolute inset-0 z-20 flex items-center justify-center bg-background/75 p-6 backdrop-blur-md',
        className,
      )}
      {...props}
    >
      {children ?? (
        <div className="max-w-sm rounded-2xl border border-destructive/30 bg-card/95 p-5 text-card-foreground shadow-xl">
          <div className="flex items-start gap-3">
            <span className="rounded-full bg-destructive/10 p-2 text-destructive">
              <AlertTriangle className="size-4" />
            </span>
            <div className="space-y-1">
              <p className="text-sm font-semibold">Avatar connection failed</p>
              <p className="text-sm text-muted-foreground">{error.message}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
