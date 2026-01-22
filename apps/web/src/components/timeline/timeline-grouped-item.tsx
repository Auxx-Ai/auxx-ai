// apps/web/src/components/timeline/timeline-grouped-item.tsx
'use client'

import { useState } from 'react'
import { cn } from '@auxx/ui/lib/utils'
import type { GroupedTimelineEvent } from '@auxx/lib/timeline/client'
import { EventIcon, getEventIcon, getEventColor } from './event-icon'
import { EventTimestamp } from './event-timestamp'
import { GroupDescription } from './group-description'
import { ChangeDetail } from './change-detail'

/**
 * Props for the TimelineGroupedItem component
 */
interface TimelineGroupedItemProps {
  groupedEvent: GroupedTimelineEvent
}

/**
 * Renders a group of similar timeline events with expandable details
 */
export function TimelineGroupedItem({ groupedEvent }: TimelineGroupedItemProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const icon = getEventIcon(groupedEvent.eventType)
  const color = getEventColor(groupedEvent.eventType)
  const eventCount = groupedEvent.events.length

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
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="flex items-start justify-between gap-4">
            {/* Group Description */}
            <div className="text-sm">
              <div className="flex flex-wrap items-center gap-2 text-[14px] text-primary-400 dark:text-primary-500">
                <GroupDescription eventType={groupedEvent.eventType} events={groupedEvent.events} />

                <button
                  type="button"
                  onClick={() => setIsExpanded(!isExpanded)}
                  className="inline-flex items-center rounded bg-accent-50 px-2 py-0.5 text-xs font-medium text-accent-700 transition-colors hover:bg-accent-100">
                  {eventCount} {eventCount === 1 ? 'change' : 'changes'}
                </button>
              </div>

              {/* Expanded Events */}
              {isExpanded && (
                <div className="mt-3 space-y-2 pl-0">
                  {groupedEvent.events.map((event) => (
                    <div key={event.id} className="text-xs">
                      {event.changes?.map((change, idx) => (
                        <ChangeDetail key={idx} change={change} />
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="pt-1">
          <EventTimestamp timestamp={groupedEvent.startedAt} />
        </div>
      </div>
    </div>
  )
}
