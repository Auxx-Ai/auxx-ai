// apps/web/src/components/timeline/timeline.tsx
'use client'

import {
  groupTimelineEventsByPeriod,
  type PeriodType,
  type TimelineItem,
} from '@auxx/lib/timeline/client'
import { Button } from '@auxx/ui/components/button'
import { useMemo, useState } from 'react'
import { TimelineEventItem } from './timeline-event-item'
import { TimelineGroupedItem } from './timeline-grouped-item'
import { TimelinePeriodHeader } from './timeline-period-header'

/**
 * Props for the Timeline component
 */
interface TimelineProps {
  events: TimelineItem[]
  onLoadMore?: () => void
  hasMore?: boolean
  isLoading?: boolean
}

/**
 * Main Timeline Container Component
 * Displays a chronological list of events grouped by time periods
 */
export function Timeline({ events, onLoadMore, hasMore, isLoading }: TimelineProps) {
  // Group events by year and period
  const groupedData = useMemo(() => groupTimelineEventsByPeriod(events), [events])

  // Track collapsed state for each period
  // Key format: "year-periodType" (e.g., "2025-upcoming", "2024-11")
  const [collapsedPeriods, setCollapsedPeriods] = useState<Set<string>>(new Set())

  /**
   * Toggle collapse state for a period
   */
  const togglePeriod = (year: number, periodType: PeriodType) => {
    const key = `${year}-${periodType}`
    setCollapsedPeriods((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  /**
   * Check if a period is collapsed
   */
  const isPeriodCollapsed = (year: number, periodType: PeriodType): boolean => {
    return collapsedPeriods.has(`${year}-${periodType}`)
  }

  return (
    <div className='timeline-events relative w-full'>
      {groupedData.map((yearGroup) => (
        <div key={yearGroup.year}>
          {yearGroup.periods.map((period, periodIndex) => {
            const isCollapsed = isPeriodCollapsed(yearGroup.year, period.type)
            const isFirstPeriodOfYear = periodIndex === 0

            return (
              <div key={`${yearGroup.year}-${period.type}`}>
                {/* Render period header */}
                <TimelinePeriodHeader
                  year={isFirstPeriodOfYear ? String(yearGroup.year) : ''}
                  period={period.title}
                  isCollapsed={isCollapsed}
                  onToggle={() => togglePeriod(yearGroup.year, period.type)}
                />

                {/* Render events if not collapsed */}
                {!isCollapsed &&
                  period.events.map((item, index) => {
                    if (item.type === 'single') {
                      return <TimelineEventItem key={item.event.id} event={item.event} />
                    }

                    return (
                      <TimelineGroupedItem
                        key={`group-${yearGroup.year}-${period.type}-${index}`}
                        groupedEvent={item}
                      />
                    )
                  })}
              </div>
            )
          })}
        </div>
      ))}

      {hasMore && (
        <div className='flex justify-center py-4'>
          <Button
            onClick={onLoadMore}
            variant='ghost'
            size='sm'
            loading={isLoading}
            loadingText='Loading...'>
            Load more
          </Button>
        </div>
      )}
    </div>
  )
}
