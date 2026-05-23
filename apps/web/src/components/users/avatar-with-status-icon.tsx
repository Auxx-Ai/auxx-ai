// apps/web/src/components/users/avatar-with-status-icon.tsx
'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { cn } from '@auxx/ui/lib/utils'
import { Headset, type LucideIcon } from 'lucide-react'
import type { ComponentProps } from 'react'

/**
 * Lightweight per-user status surfaced as a small dot overlay on top of a
 * user `Avatar`. Mirrors the pattern used by `AppWithStatusIcon` for app
 * icons, but for people. Today only chat-duty (`on_duty`) renders an
 * overlay; future presence states (online/away/offline) can be added here so
 * every consumer composes through one component.
 */
export type UserStatus = 'on_duty' | 'off_duty' | 'none'

interface UserStatusOption {
  label: string
  /** Tailwind background class for the dot, or `null` to skip the overlay. */
  color: string | null
  /** Optional icon rendered inside the dot. */
  icon?: LucideIcon
}

const USER_STATUS_OPTIONS: Record<UserStatus, UserStatusOption> = {
  on_duty: { label: 'On chat duty', color: 'bg-emerald-500', icon: Headset },
  off_duty: { label: 'Off chat duty', color: null },
  none: { label: '', color: null },
}

interface AvatarWithStatusIconProps {
  status: UserStatus
  src?: string | null
  alt?: string
  /** Two-letter initials for the fallback. Caller already computes these. */
  fallback?: string
  /** Class on the Avatar element (controls size — defaults to size-7). */
  className?: string
  /** Class on the outer positioning wrapper (rarely needed). */
  wrapperClassName?: string
  imgProps?: ComponentProps<typeof AvatarImage>
}

export function AvatarWithStatusIcon({
  status,
  src,
  alt,
  fallback,
  className,
  wrapperClassName,
  imgProps,
}: AvatarWithStatusIconProps) {
  const { label, color, icon: StatusIcon } = USER_STATUS_OPTIONS[status]
  return (
    <div className={cn('relative inline-flex shrink-0', wrapperClassName)}>
      <Avatar className={cn('size-7', className)}>
        <AvatarImage src={src || undefined} alt={alt} {...imgProps} />
        <AvatarFallback className='text-[10px]'>{fallback || '?'}</AvatarFallback>
      </Avatar>
      {color && (
        <span
          aria-label={label}
          className={cn(
            'absolute -bottom-0.5 -right-0.5 inline-flex size-3 items-center justify-center rounded-full ring-2 ring-background',
            color
          )}>
          {StatusIcon && <StatusIcon className='size-2 text-white' strokeWidth={3} />}
        </span>
      )}
    </div>
  )
}
