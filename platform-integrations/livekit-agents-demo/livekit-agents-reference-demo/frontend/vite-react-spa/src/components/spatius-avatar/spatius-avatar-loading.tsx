'use client'

import type { HTMLAttributes, ReactNode } from 'react'

import { useSpatiusAvatarContext } from './spatius-avatar-context'
import { cn } from '../../utils'

export interface SpatiusAvatarLoadingProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode
}

export function SpatiusAvatarLoading({ className, children, ...props }: SpatiusAvatarLoadingProps) {
  const { downloadProgress, isLoading, status } = useSpatiusAvatarContext()
  const progress = downloadProgress !== null ? Math.max(0, Math.min(100, downloadProgress * 100)) : null

  if (!isLoading) {
    return null
  }

  return (
    <div
      className={cn(
        'absolute inset-0 z-10 flex items-center justify-center bg-background/60 p-6 backdrop-blur-md',
        className,
      )}
      {...props}
    >
      {children ?? (
        <div className="w-full max-w-xs rounded-2xl border border-border/70 bg-card/95 p-5 text-card-foreground shadow-xl">
          <div className="flex items-center gap-3">
            <div className="size-9 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
            <div>
              <p className="text-sm font-semibold">Preparing Spatius avatar</p>
              <p className="text-xs text-muted-foreground capitalize">{status}</p>
            </div>
          </div>

          {progress !== null ? (
            <div className="mt-4 space-y-2">
              <div
                aria-valuemax={100}
                aria-valuemin={0}
                aria-valuenow={progress}
                className="relative h-2 w-full overflow-hidden rounded-full bg-secondary/70"
                role="progressbar"
              >
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {Math.round(progress)}% of avatar assets ready
              </p>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
