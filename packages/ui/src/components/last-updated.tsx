// apps/web/src/components/ui/last-updated.tsx

'use client'

import { useEffect, useState } from 'react'
import { formatDistanceToNow, format } from 'date-fns'
import { cn } from '@auxx/ui/lib/utils'

interface LastUpdatedProps {
  timestamp: Date | string | number
  format?: 'relative' | 'absolute' | 'both'
  className?: string
  prefix?: string
  suffix?: string
  includeSeconds?: boolean
}

/**
 * Smart component that displays a timestamp and automatically updates
 * based on how recent the timestamp is.
 *
 * Update intervals:
 * - < 1 minute: every 1 second
 * - 1-5 minutes: every 5 seconds
 * - 5-30 minutes: every 30 seconds
 * - 30 min - 2 hours: every 1 minute
 * - 2-24 hours: every 5 minutes
 * - > 24 hours: no updates (static)
 */
export const LastUpdated: React.FC<LastUpdatedProps> = ({
  timestamp,
  format: displayFormat = 'relative',
  className,
  prefix,
  suffix,
  includeSeconds = false,
}) => {
  const [, setTick] = useState(0)

  useEffect(() => {
    // Convert timestamp to Date object
    const date = new Date(timestamp)
    const now = new Date()
    const diffInMs = now.getTime() - date.getTime()
    const diffInSeconds = Math.floor(diffInMs / 1000)
    const diffInMinutes = Math.floor(diffInSeconds / 60)
    const diffInHours = Math.floor(diffInMinutes / 60)

    // Determine update interval based on age
    let intervalMs: number | null = null

    if (diffInSeconds < 60) {
      // Less than 1 minute: update every second
      intervalMs = 1000
    } else if (diffInMinutes < 5) {
      // 1-5 minutes: update every 5 seconds
      intervalMs = 5000
    } else if (diffInMinutes < 30) {
      // 5-30 minutes: update every 30 seconds
      intervalMs = 30000
    } else if (diffInHours < 2) {
      // 30 minutes - 2 hours: update every minute
      intervalMs = 60000
    } else if (diffInHours < 24) {
      // 2-24 hours: update every 5 minutes
      intervalMs = 300000
    }
    // > 24 hours: no updates needed (intervalMs remains null)

    if (intervalMs) {
      const interval = setInterval(() => {
        setTick((tick) => tick + 1)
      }, intervalMs)

      return () => clearInterval(interval)
    }
  }, [timestamp])

  // Format the timestamp
  const date = new Date(timestamp)
  let displayText = ''

  switch (displayFormat) {
    case 'relative':
      displayText = formatDistanceToNow(date, { addSuffix: true, includeSeconds })
      break
    case 'absolute':
      displayText = format(date, "MMM d, yyyy 'at' h:mm a")
      break
    case 'both':
      const relative = formatDistanceToNow(date, { addSuffix: true, includeSeconds })
      const absolute = format(date, "MMM d, yyyy 'at' h:mm a")
      displayText = `${relative} (${absolute})`
      break
  }

  // Add prefix and suffix
  if (prefix) displayText = `${prefix} ${displayText}`
  if (suffix) displayText = `${displayText} ${suffix}`

  return <span className={cn('text-muted-foreground', className)}>{displayText}</span>
}
