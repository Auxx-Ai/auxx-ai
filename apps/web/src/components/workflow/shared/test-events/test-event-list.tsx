// apps/web/src/components/workflow/shared/test-events/test-event-list.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { toastSuccess } from '@auxx/ui/components/toast'
import { formatDistanceToNow } from 'date-fns'
import { ChevronDown, ChevronRight, Clock, Copy } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import type { BaseTestEvent } from './types'

interface TestEventListProps<T extends BaseTestEvent> {
  events: T[]
  onClear: () => void
  /** Renders badges/icons in the collapsed event header row */
  renderEventBadges: (event: T) => ReactNode
  /** Renders the expanded detail section for an event */
  renderEventDetail: (event: T) => ReactNode
  /** Optional extra actions in the expanded section */
  renderEventActions?: (event: T) => ReactNode
  emptyTitle?: string
  emptyDescription?: string
}

export function TestEventList<T extends BaseTestEvent>({
  events,
  onClear,
  renderEventBadges,
  renderEventDetail,
  renderEventActions,
  emptyTitle = 'No events captured yet',
  emptyDescription = 'Events will appear here in real-time',
}: TestEventListProps<T>) {
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set())

  const toggleExpanded = (eventId: string) => {
    setExpandedEvents((prev) => {
      const next = new Set(prev)
      if (next.has(eventId)) {
        next.delete(eventId)
      } else {
        next.add(eventId)
      }
      return next
    })
  }

  const copyEventData = (event: T) => {
    navigator.clipboard.writeText(JSON.stringify(event, null, 2))
    toastSuccess({ title: 'Event data copied' })
  }

  if (events.length === 0) {
    return (
      <div className='text-center py-8 text-muted-foreground'>
        <p className='text-sm'>{emptyTitle}</p>
        <p className='text-xs mt-1'>{emptyDescription}</p>
      </div>
    )
  }

  return (
    <div className='space-y-2'>
      <div className='flex items-center justify-between mb-2'>
        <span className='text-xs text-muted-foreground'>
          {events.length} event{events.length !== 1 ? 's' : ''} captured
        </span>
        <Button variant='ghost' size='xs' onClick={onClear} className='h-6'>
          Clear all
        </Button>
      </div>

      <div className='space-y-2 max-h-96 overflow-y-auto'>
        {events.map((event) => {
          const isExpanded = expandedEvents.has(event.id)

          return (
            <div key={event.id} className='border rounded-lg bg-background'>
              <div
                className='flex items-center justify-between p-3 cursor-pointer hover:bg-muted/50'
                onClick={() => toggleExpanded(event.id)}>
                <div className='flex items-center gap-2 flex-1'>
                  <button className='p-0.5' type='button'>
                    {isExpanded ? (
                      <ChevronDown className='h-4 w-4' />
                    ) : (
                      <ChevronRight className='h-4 w-4' />
                    )}
                  </button>

                  {renderEventBadges(event)}

                  <span className='text-xs text-muted-foreground flex items-center gap-1'>
                    <Clock className='h-3 w-3' />
                    {formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })}
                  </span>

                  {event.responseTime && (
                    <span className='text-xs text-muted-foreground'>{event.responseTime}ms</span>
                  )}
                </div>

                <Button
                  variant='ghost'
                  size='xs'
                  onClick={(e) => {
                    e.stopPropagation()
                    copyEventData(event)
                  }}
                  className='h-6'>
                  <Copy className='h-3 w-3' />
                </Button>
              </div>

              {isExpanded && (
                <div className='border-t px-3 py-2 space-y-2'>
                  {renderEventDetail(event)}
                  {renderEventActions?.(event)}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
