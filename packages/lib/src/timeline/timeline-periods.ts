// packages/lib/src/timeline/timeline-periods.ts

import { isSameWeek } from '@auxx/utils/date'
import type { TimelineItem } from './types'

/**
 * Period type for timeline grouping
 * - Special periods: "upcoming", "this-week"
 * - Month periods: 0-11 (January-December)
 */
export type PeriodType = 'upcoming' | 'this-week' | number

/**
 * Enum-like object for period types
 */
export const PeriodTypes = {
  UPCOMING: 'upcoming' as const,
  THIS_WEEK: 'this-week' as const,
  JANUARY: 0,
  FEBRUARY: 1,
  MARCH: 2,
  APRIL: 3,
  MAY: 4,
  JUNE: 5,
  JULY: 6,
  AUGUST: 7,
  SEPTEMBER: 8,
  OCTOBER: 9,
  NOVEMBER: 10,
  DECEMBER: 11,
} as const

/**
 * Month names for display
 */
export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

/**
 * Get display title for a period type
 */
export function getPeriodTitle(periodType: PeriodType): string {
  if (periodType === 'upcoming') {
    return 'Upcoming'
  }
  if (periodType === 'this-week') {
    return 'This week'
  }
  // Month index
  return MONTH_NAMES[periodType as number] || 'Unknown'
}

/**
 * Group identifier for timeline events
 */
export interface TimelinePeriodGroup {
  year: number
  type: PeriodType
}

/**
 * Timeline events grouped by period
 */
export interface GroupedTimelineData {
  year: number
  periods: {
    type: PeriodType
    title: string
    events: TimelineItem[]
  }[]
}

/**
 * Timeline item with period group metadata
 */
interface TimelineItemWithGroup {
  item: TimelineItem
  group: TimelinePeriodGroup
  date: Date
}

/**
 * Determine the period type for a given date
 * @param date - The date to categorize
 * @param now - The current date/time for comparison
 * @returns The period type (upcoming, this-week, or month index)
 */
export function getPeriodType(date: Date, now: Date): PeriodType {
  // Future dates are "upcoming"
  if (date > now) {
    return 'upcoming'
  }

  // Same week as now is "this-week"
  if (isSameWeek(date, now)) {
    return 'this-week'
  }

  // Otherwise, return the month index (0-11)
  return date.getMonth()
}

/**
 * Get the primary date from a timeline item
 * @param item - Timeline item (single or grouped)
 * @returns The primary date to use for grouping
 */
function getItemDate(item: TimelineItem): Date {
  if (item.type === 'single') {
    return new Date(item.event.startedAt)
  }
  // For grouped events, use the startedAt of the first event
  return new Date(item.startedAt)
}

/**
 * Sort period types for display order
 * Order: upcoming → this-week → December → November → ... → January
 * @param a - First period type
 * @param b - Second period type
 * @returns Sort comparison result
 */
function sortPeriods(a: PeriodType, b: PeriodType): number {
  // Upcoming comes first
  if (a === 'upcoming') return -1
  if (b === 'upcoming') return 1

  // This week comes second
  if (a === 'this-week') return -1
  if (b === 'this-week') return 1

  // Months in reverse order (December → January)
  return (b as number) - (a as number)
}

/**
 * Group timeline events by year and period
 * @param events - Array of timeline items to group
 * @param now - Current date/time for period calculation (defaults to now)
 * @returns Array of grouped timeline data, sorted by year (descending) and period
 */
export function groupTimelineEventsByPeriod(
  events: TimelineItem[],
  now: Date = new Date()
): GroupedTimelineData[] {
  // Map events to include their group metadata
  const itemsWithGroups: TimelineItemWithGroup[] = events.map((item) => {
    const date = getItemDate(item)
    return {
      item,
      date,
      group: {
        year: date.getFullYear(),
        type: getPeriodType(date, now),
      },
    }
  })

  // Group by year, then by period
  const yearMap = new Map<number, Map<PeriodType, TimelineItem[]>>()

  for (const { item, group } of itemsWithGroups) {
    let periodMap = yearMap.get(group.year)
    if (!periodMap) {
      periodMap = new Map()
      yearMap.set(group.year, periodMap)
    }

    let periodEvents = periodMap.get(group.type)
    if (!periodEvents) {
      periodEvents = []
      periodMap.set(group.type, periodEvents)
    }

    periodEvents.push(item)
  }

  // Convert to array format and sort
  const result: GroupedTimelineData[] = []

  // Sort years descending (2025, 2024, 2023, ...)
  const sortedYears = Array.from(yearMap.keys()).sort((a, b) => b - a)

  for (const year of sortedYears) {
    const periodMap = yearMap.get(year)!
    const periods: GroupedTimelineData['periods'] = []

    // Sort periods
    const sortedPeriodTypes = Array.from(periodMap.keys()).sort(sortPeriods)

    for (const periodType of sortedPeriodTypes) {
      periods.push({
        type: periodType,
        title: getPeriodTitle(periodType),
        events: periodMap.get(periodType)!,
      })
    }

    result.push({ year, periods })
  }

  return result
}
