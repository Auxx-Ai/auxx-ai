// apps/web/src/components/ui/timestamp.tsx

import { cn } from '@auxx/ui/lib/utils'
import { format, formatDistanceToNow } from 'date-fns'
import React, { useState } from 'react'

interface TimestampProps {
  /**
   * The date to display - can be Date object, string, or number
   */
  date: Date | string | number

  /**
   * Whether to show relative time (e.g., "2 hours ago") or full format
   * @default true
   */
  showRelative?: boolean

  /**
   * Format string for full date display
   * @default 'PPpp' (e.g., "Jul 29, 2025 at 9:52 PM")
   */
  fullFormat?: string

  /**
   * Additional CSS classes
   */
  className?: string

  /**
   * Fallback text when date is invalid
   * @default 'Invalid date'
   */
  fallbackText?: string
}

/**
 * A clickable timestamp component that toggles between relative time and full formatted time
 */
export function Timestamp({
  date,
  showRelative = true,
  fullFormat = 'PPpp',
  className,
  fallbackText = 'Invalid date',
}: TimestampProps) {
  const [displayMode, setDisplayMode] = useState<'relative' | 'full'>(
    showRelative ? 'relative' : 'full'
  )

  // Validate and parse the date
  const parsedDate = React.useMemo(() => {
    try {
      const dateObj = new Date(date)
      if (isNaN(dateObj.getTime())) {
        return null
      }
      return dateObj
    } catch {
      return null
    }
  }, [date])

  // Handle click to toggle display mode
  const handleClick = () => {
    if (showRelative) {
      setDisplayMode((prev) => (prev === 'relative' ? 'full' : 'relative'))
    }
  }

  // Return fallback if date is invalid
  if (!parsedDate) {
    return <span className={cn('text-muted-foreground', className)}>{fallbackText}</span>
  }

  // Generate display text
  const displayText = React.useMemo(() => {
    if (!showRelative) {
      return format(parsedDate, fullFormat)
    }

    return displayMode === 'relative'
      ? formatDistanceToNow(parsedDate, { addSuffix: true })
      : format(parsedDate, fullFormat)
  }, [parsedDate, displayMode, showRelative, fullFormat])

  // Generate tooltip text (opposite of what's displayed)
  const tooltipText = React.useMemo(() => {
    if (!showRelative) {
      return formatDistanceToNow(parsedDate, { addSuffix: true })
    }

    return displayMode === 'relative'
      ? format(parsedDate, fullFormat)
      : formatDistanceToNow(parsedDate, { addSuffix: true })
  }, [parsedDate, displayMode, showRelative, fullFormat])

  const baseClasses = showRelative ? 'cursor-pointer hover:text-foreground transition-colors' : ''

  return (
    <span onClick={handleClick} title={tooltipText} className={cn(baseClasses, className)}>
      {displayText}
    </span>
  )
}
