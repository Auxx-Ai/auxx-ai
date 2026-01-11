// packages/types/task/index.ts

/**
 * Duration object representing a time offset
 * Can contain one or more duration units
 * Example: { days: 7 } = one week
 * Example: { months: 1, days: 15 } = 1 month and 15 days
 */
export interface RelativeDate {
  days?: number
  weeks?: number
  months?: number
  years?: number
}

/**
 * Absolute date representation
 * Stored as ISO string in database, converted to Date for calculations
 */
export interface AbsoluteDate {
  type: 'static'
  value: Date | string
}

/**
 * Union type for any deadline representation
 */
export type Deadline = RelativeDate | AbsoluteDate | null

/**
 * Direction indicator for UI display
 */
export type DateDirection = 'past' | 'current' | 'future'

/**
 * Predefined relative date option (displayed in UI menu)
 */
export interface PredefinedDateOption {
  label: string
  icon: string
  duration: RelativeDate | 'eom' | 'next-quarter'
  direction: DateDirection
}

/**
 * Input for timezone-aware date calculation
 */
export interface DateCalculationInput {
  baseDate: Date
  duration: RelativeDate
  timezone: string
}

/**
 * Output from date calculation
 */
export interface DateCalculationOutput {
  targetDate: Date
  formattedLabel: string
  isoString: string
}

/**
 * Predefined date options for quick selection in UI
 * These are displayed in the date picker dropdown menu
 */
export const PREDEFINED_DATE_OPTIONS: PredefinedDateOption[] = [
  {
    label: 'Today',
    icon: 'Calendar',
    duration: { days: 0 },
    direction: 'current',
  },
  {
    label: 'Tomorrow',
    icon: 'CalendarArrowRight',
    duration: { days: 1 },
    direction: 'future',
  },
  {
    label: 'Yesterday',
    icon: 'CalendarArrowLeft',
    duration: { days: -1 },
    direction: 'past',
  },
  {
    label: 'One week from now',
    icon: 'CalendarArrowRight',
    duration: { days: 7 },
    direction: 'future',
  },
  {
    label: 'One week ago',
    icon: 'CalendarArrowLeft',
    duration: { days: -7 },
    direction: 'past',
  },
  {
    label: 'One month from now',
    icon: 'CalendarArrowRight',
    duration: { months: 1 },
    direction: 'future',
  },
  {
    label: 'One month ago',
    icon: 'CalendarArrowLeft',
    duration: { months: -1 },
    direction: 'past',
  },
  {
    label: 'End of this week',
    icon: 'CalendarArrowRight',
    duration: { days: 5 },
    direction: 'future',
  },
  {
    label: 'End of this month',
    icon: 'CalendarArrowRight',
    duration: 'eom',
    direction: 'future',
  },
  {
    label: 'Next quarter',
    icon: 'CalendarArrowRight',
    duration: 'next-quarter',
    direction: 'future',
  },
]

/**
 * Compare two RelativeDate objects for logical equality
 */
export function compareDurations(a: RelativeDate, b: RelativeDate): boolean {
  return (
    (a.days ?? 0) === (b.days ?? 0) &&
    (a.weeks ?? 0) === (b.weeks ?? 0) &&
    (a.months ?? 0) === (b.months ?? 0) &&
    (a.years ?? 0) === (b.years ?? 0)
  )
}

/**
 * Find a predefined option that matches a duration
 * Returns the first match or undefined
 */
export function findPredefinedOption(duration: RelativeDate): PredefinedDateOption | undefined {
  return PREDEFINED_DATE_OPTIONS.find((option) => {
    if (typeof option.duration === 'string') return false
    return compareDurations(option.duration, duration)
  })
}

// ============================================================================
// Task UI Types
// ============================================================================

/**
 * Task status derived from completedAt/archivedAt
 */
export type TaskStatus = 'open' | 'completed' | 'archived'

/**
 * Period grouping for task list display
 */
export type TaskPeriodType =
  | 'overdue'
  | 'today'
  | 'tomorrow'
  | 'this-week'
  | 'upcoming'
  | 'completed'
  | 'no-date'

/**
 * Task view mode - determines UI variant
 */
export type TaskViewMode = 'entity' | 'global'
