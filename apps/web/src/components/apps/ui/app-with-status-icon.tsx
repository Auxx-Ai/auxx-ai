// apps/web/src/components/apps/ui/app-with-status-icon.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { Check } from 'lucide-react'
import { AppIcon, type AppIconProps } from '~/components/apps/ui/app-icon'

/**
 * Connection status surfaced as a small dot overlay on top of `AppIcon`.
 * Centralized here so every callsite (catalog rows, picker, workflow panel)
 * uses the same color mapping. See
 * plans/kopilot/apps/agent-credentials.md §5.1.
 */
export type AppConnectionStatus =
  | 'connected'
  | 'expired'
  | 'not_connected'
  | 'gone'
  | 'unbound'
  | 'none'

/**
 * Color class for the small status dot, keyed by a credential's resolved
 * state. `none` returns `null` so the wrapper can skip the overlay entirely.
 * Co-located so other surfaces that already render their own pill
 * (`AppSettingsTrigger`) can adopt the same mapping incrementally.
 */
export function getConnectionStatusColor(status: AppConnectionStatus): string | null {
  switch (status) {
    case 'connected':
      return 'bg-green-500'
    case 'expired':
      return 'bg-amber-500'
    case 'unbound':
      return 'bg-amber-500'
    case 'gone':
    case 'not_connected':
      return 'bg-red-500'
    case 'none':
      return null
  }
}

interface AppWithStatusIconProps extends AppIconProps {
  status: AppConnectionStatus
  /** Optional class for the outer positioning wrapper (rarely needed). */
  wrapperClassName?: string
}

export function AppWithStatusIcon({
  status,
  wrapperClassName,
  ...iconProps
}: AppWithStatusIconProps) {
  const dotColor = getConnectionStatusColor(status)
  return (
    <div className={cn('relative inline-flex shrink-0', wrapperClassName)}>
      <AppIcon {...iconProps} />
      {dotColor && (
        <span
          className={cn(
            'absolute -top-0.5 -right-0.5 inline-flex size-2.5 items-center justify-center rounded-full ring-1 ring-background',
            dotColor
          )}>
          {status === 'connected' && <Check className='size-2 text-white' strokeWidth={3} />}
        </span>
      )}
    </div>
  )
}
