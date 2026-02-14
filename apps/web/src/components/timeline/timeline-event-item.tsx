// apps/web/src/components/timeline/timeline-event-item.tsx
'use client'

import type { TimelineEventBase } from '@auxx/lib/timeline/client'
import { cn } from '@auxx/ui/lib/utils'
import { useState } from 'react'
import { ChangeDetail } from './change-detail'
import { EventDescription } from './event-description'
import { EventIcon, getEventColor, getEventIcon } from './event-icon'
import { EventTimestamp } from './event-timestamp'

/**
 * Props for the TimelineEventItem component
 */
interface TimelineEventItemProps {
  event: TimelineEventBase
  compact?: boolean
}

/**
 * Renders a single timeline event with icon, description, and timestamp
 */
export function TimelineEventItem({ event, compact = false }: TimelineEventItemProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const icon = getEventIcon(event.eventType)
  const color = getEventColor(event.eventType)

  return (
    <div
      className={cn(
        'relative pb-6 last:pb-3 before:absolute before:inset-y-0 before:left-4.5 before:w-px before:bg-primary-300 before:z-0 last:before:hidden'
      )}>
      <div
        className={cn(
          'relative z-1 flex ps-1 pe-2 py-1 gap-2 bg-illustration ring-border-illustration origin-bottom rounded-2xl border border-transparent shadow shadow-black/10 ring-1 transition-all duration-300'
        )}>
        {/* Icon */}
        <EventIcon icon={icon} color={color} />

        {/* Content */}
        <div className='min-w-0 flex-1'>
          <div className='flex items-start justify-between gap-4'>
            {/* Event Description */}
            <div className='text-[14px] text-primary-400 dark:text-primary-500'>
              <EventDescription event={event} onToggleExpand={() => setIsExpanded(!isExpanded)} />

              {/* Expanded Details */}
              {isExpanded && event.changes && event.changes.length > 0 && (
                <div className='mt-2 space-y-1 text-xs'>
                  {event.changes.map((change, idx) => (
                    <ChangeDetail key={idx} change={change} />
                  ))}
                </div>
              )}
            </div>

            {/* Timestamp */}
            <div className='pt-1'>
              <EventTimestamp timestamp={event.startedAt} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
