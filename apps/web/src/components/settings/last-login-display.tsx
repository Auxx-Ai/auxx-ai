// apps/web/src/components/settings/last-login-display.tsx
'use client'

import { formatInTimezone, formatRelativeTime } from '@auxx/utils'

interface LastLoginDisplayProps {
  lastLoginAt: Date | string | null
  timezone?: string
}

/**
 * Component to display the user's last login information
 */
export function LastLoginDisplay({ lastLoginAt, timezone = 'UTC' }: LastLoginDisplayProps) {
  if (!lastLoginAt) {
    return <div className="text-sm text-muted-foreground">No login history available</div>
  }

  const relativeTime = formatRelativeTime(lastLoginAt)
  const absoluteTime = formatInTimezone(lastLoginAt, timezone, 'PPpp')

  return (
    <div className="space-y-1">
      <div className="text-sm font-medium">Last Login</div>
      <div className="text-sm text-muted-foreground">
        {relativeTime} ({absoluteTime})
      </div>
    </div>
  )
}
