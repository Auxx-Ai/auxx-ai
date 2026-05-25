// apps/web/src/components/users/presence-dot.tsx
'use client'

import type { PresenceState } from '@auxx/lib/presence'
import { cn } from '@auxx/ui/lib/utils'

/**
 * Small colored dot reflecting auto-derived presence. Compose alongside any
 * user avatar — `AvatarWithStatusIcon` already owns the bottom-right corner
 * (chat-duty headset), so this lives bottom-left by default.
 *
 *  - online  → emerald
 *  - away    → amber
 *  - offline → neutral grey (or hidden when `hideOffline` is true)
 */
interface PresenceDotProps {
  state: PresenceState
  /** Hide the dot entirely when state is `offline`. */
  hideOffline?: boolean
  className?: string
}

const STATE_COLOR: Record<PresenceState, string> = {
  online: 'bg-emerald-500',
  away: 'bg-amber-500',
  offline: 'bg-muted-foreground/40',
}

export function PresenceDot({ state, hideOffline = false, className }: PresenceDotProps) {
  if (hideOffline && state === 'offline') return null
  return (
    <span
      aria-label={state}
      className={cn(
        'inline-flex size-2 shrink-0 rounded-full ring-2 ring-background',
        STATE_COLOR[state],
        className
      )}
    />
  )
}
