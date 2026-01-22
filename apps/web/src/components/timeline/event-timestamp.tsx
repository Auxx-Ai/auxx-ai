// apps/web/src/components/timeline/event-timestamp.tsx
'use client'

import { formatDistanceToNowStrict } from 'date-fns'

/**
 * Props for the EventTimestamp component
 */
interface EventTimestampProps {
  timestamp: Date
}

/**
 * Displays a relative timestamp for timeline events
 */
export function EventTimestamp({ timestamp }: EventTimestampProps) {
  return (
    <div className="flex-shrink-0 whitespace-nowrap text-xs text-primary-muted">
      {formatDistanceToNowStrict(new Date(timestamp), { addSuffix: true })}
    </div>
  )
}
