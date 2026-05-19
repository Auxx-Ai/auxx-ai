// apps/web/src/components/apps/ui/app-with-status-icon.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { Check, Clock, type LucideIcon, Minus, Plug, X } from 'lucide-react'
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

export interface AppConnectionStatusOption {
  label: string
  /** Tailwind background class for the dot, or `null` to skip the overlay. */
  color: string | null
  icon: LucideIcon
}

/**
 * Status metadata keyed by a credential's resolved state. `none` has a
 * `null` color so wrappers can skip the overlay entirely. Co-located so
 * other surfaces that already render their own pill (`AppSettingsTrigger`)
 * can adopt the same mapping incrementally.
 */
export const appConnectionStatusOptions: Record<AppConnectionStatus, AppConnectionStatusOption> = {
  connected: { label: 'Connected', color: 'bg-green-500', icon: Check },
  expired: { label: 'Expired', color: 'bg-amber-500', icon: Clock },
  unbound: { label: 'Not set', color: 'bg-amber-500', icon: Minus },
  gone: { label: 'Disconnected', color: 'bg-red-500', icon: X },
  not_connected: { label: 'Disconnected', color: 'bg-red-500', icon: Plug },
  none: { label: '', color: null, icon: Minus },
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
  const { color, icon: StatusIcon } = appConnectionStatusOptions[status]
  return (
    <div className={cn('relative inline-flex shrink-0', wrapperClassName)}>
      <AppIcon {...iconProps} />
      {color && (
        <span
          className={cn(
            'absolute top-0 right-0 inline-flex size-2 items-center justify-center rounded-full ring-1 ring-background',
            color
          )}>
          {status === 'connected' && <StatusIcon className='size-2 text-white' />}
        </span>
      )}
    </div>
  )
}
