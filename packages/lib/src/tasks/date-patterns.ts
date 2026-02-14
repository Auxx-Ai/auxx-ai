// packages/lib/src/tasks/date-patterns.ts

import type { RelativeDate } from '@auxx/types/task'

/**
 * Pattern definition for date matching
 */
export interface DatePattern {
  /** Unique identifier */
  id: string
  /** Regex pattern to match */
  pattern: RegExp
  /** Function to extract duration from match */
  extractor: (match: RegExpMatchArray, baseDate: Date) => RelativeDate | 'eom' | 'next-quarter'
  /** Human-readable label generator */
  labelGenerator: (match: RegExpMatchArray) => string
  /** Confidence score for this pattern (0-1) */
  confidence: number
  /** Priority (higher = matched first) */
  priority: number
  /** Whether this pattern matches past dates */
  isPast?: boolean
}

// ============================================================================
// Shared Constants & Helpers
// ============================================================================

/**
 * Text number to digit mapping (one through twelve)
 */
const TEXT_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
}

/**
 * Regex pattern for text numbers: "one|two|three|...|twelve"
 */
const TEXT_NUMBER_PATTERN = Object.keys(TEXT_NUMBERS).join('|')

/**
 * Combined pattern for any number (digit or text): "(\d+|one|two|...)"
 */
const NUMBER_PATTERN = `(\\d+|${TEXT_NUMBER_PATTERN})`

/**
 * Parse a number from either digit string or text ("3" or "three" → 3)
 */
function parseNumber(value: string): number {
  const num = parseInt(value, 10)
  if (!Number.isNaN(num)) return num
  return TEXT_NUMBERS[value.toLowerCase()] ?? 0
}

/**
 * Weekday name to number mapping (0=Sunday, 6=Saturday)
 */
const WEEKDAY_MAP: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
}

/**
 * Regex pattern for all weekday names (generated from WEEKDAY_MAP keys)
 */
const WEEKDAY_PATTERN = Object.keys(WEEKDAY_MAP).join('|')

/**
 * Abbreviation to full weekday name mapping (for display labels)
 */
const WEEKDAY_FULL_NAMES: Record<string, string> = {
  sun: 'Sunday',
  sunday: 'Sunday',
  mon: 'Monday',
  monday: 'Monday',
  tue: 'Tuesday',
  tues: 'Tuesday',
  tuesday: 'Tuesday',
  wed: 'Wednesday',
  wednesday: 'Wednesday',
  thu: 'Thursday',
  thur: 'Thursday',
  thurs: 'Thursday',
  thursday: 'Thursday',
  fri: 'Friday',
  friday: 'Friday',
  sat: 'Saturday',
  saturday: 'Saturday',
}

/**
 * Get days until specific weekday
 * @param targetDay 0=Sunday, 1=Monday, ..., 6=Saturday
 * @param baseDate Reference date
 * @param nextWeek If true, always return next week's occurrence
 */
function getDaysUntilWeekday(targetDay: number, baseDate: Date, nextWeek = false): number {
  const currentDay = baseDate.getDay()
  let daysUntil = targetDay - currentDay

  if (daysUntil <= 0 || nextWeek) {
    daysUntil += 7
  }

  return daysUntil
}

/**
 * Get days until end of current week (Sunday)
 */
function getDaysUntilEndOfWeek(baseDate: Date): number {
  const currentDay = baseDate.getDay()
  return currentDay === 0 ? 0 : 7 - currentDay
}

/**
 * Get full weekday name from abbreviation or full name
 */
function getWeekdayName(input: string): string {
  return WEEKDAY_FULL_NAMES[input.toLowerCase()] || input
}

// ============================================================================
// DATE_PATTERNS - Ordered by priority (highest first)
// ============================================================================

/**
 * DATE_PATTERNS
 * Each pattern includes:
 * - Regex that matches the date expression
 * - Extractor function to convert match to RelativeDate
 * - Label generator for display
 * - Confidence score (how certain we are this is a date)
 */
export const DATE_PATTERNS: DatePattern[] = [
  // ============================================================================
  // Priority 100: Explicit relative expressions (FUTURE)
  // ============================================================================

  {
    id: 'today',
    pattern: /\b(today)\b/i,
    extractor: () => ({ days: 0 }),
    labelGenerator: () => 'Today',
    confidence: 1.0,
    priority: 100,
    isPast: false,
  },

  {
    id: 'tomorrow',
    pattern: /\b(tomorrow|tmrw|tmw)\b/i,
    extractor: () => ({ days: 1 }),
    labelGenerator: () => 'Tomorrow',
    confidence: 1.0,
    priority: 100,
    isPast: false,
  },

  // ============================================================================
  // Priority 90: "In X days/weeks/months" expressions (FUTURE)
  // Supports both digits and text numbers (e.g., "in 3 days" or "in three days")
  // ============================================================================

  {
    id: 'in-n-days',
    pattern: new RegExp(`\\bin\\s+${NUMBER_PATTERN}\\s*days?\\b`, 'i'),
    extractor: (match) => ({ days: parseNumber(match[1]) }),
    labelGenerator: (match) => {
      const n = parseNumber(match[1])
      return n === 1 ? 'In 1 day' : `In ${n} days`
    },
    confidence: 1.0,
    priority: 90,
    isPast: false,
  },

  {
    id: 'in-n-weeks',
    pattern: new RegExp(`\\bin\\s+${NUMBER_PATTERN}\\s*weeks?\\b`, 'i'),
    extractor: (match) => ({ weeks: parseNumber(match[1]) }),
    labelGenerator: (match) => {
      const n = parseNumber(match[1])
      return n === 1 ? 'In 1 week' : `In ${n} weeks`
    },
    confidence: 1.0,
    priority: 90,
    isPast: false,
  },

  {
    id: 'in-n-months',
    pattern: new RegExp(`\\bin\\s+${NUMBER_PATTERN}\\s*months?\\b`, 'i'),
    extractor: (match) => ({ months: parseNumber(match[1]) }),
    labelGenerator: (match) => {
      const n = parseNumber(match[1])
      return n === 1 ? 'In 1 month' : `In ${n} months`
    },
    confidence: 1.0,
    priority: 90,
    isPast: false,
  },

  // ============================================================================
  // Priority 85: "Next" expressions (FUTURE)
  // ============================================================================

  {
    id: 'next-week',
    pattern: /\b(next\s+week)\b/i,
    extractor: () => ({ weeks: 1 }),
    labelGenerator: () => 'Next week',
    confidence: 1.0,
    priority: 85,
    isPast: false,
  },

  {
    id: 'next-month',
    pattern: /\b(next\s+month)\b/i,
    extractor: () => ({ months: 1 }),
    labelGenerator: () => 'Next month',
    confidence: 1.0,
    priority: 85,
    isPast: false,
  },

  {
    id: 'next-quarter',
    pattern: /\b(next\s+quarter)\b/i,
    extractor: () => 'next-quarter',
    labelGenerator: () => 'Next quarter',
    confidence: 1.0,
    priority: 85,
    isPast: false,
  },

  {
    id: 'next-year',
    pattern: /\b(next\s+year)\b/i,
    extractor: () => ({ years: 1 }),
    labelGenerator: () => 'Next year',
    confidence: 1.0,
    priority: 85,
    isPast: false,
  },

  // ============================================================================
  // Priority 80: "Next [weekday]" expressions (FUTURE)
  // ============================================================================

  {
    id: 'next-weekday',
    pattern: new RegExp(`\\bnext\\s+(${WEEKDAY_PATTERN})\\b`, 'i'),
    extractor: (match, baseDate) => {
      const dayName = match[1].toLowerCase()
      const targetDay = WEEKDAY_MAP[dayName]
      if (targetDay === undefined) return { days: 7 }
      const days = getDaysUntilWeekday(targetDay, baseDate, true)
      return { days }
    },
    labelGenerator: (match) => `Next ${getWeekdayName(match[1])}`,
    confidence: 1.0,
    priority: 80,
    isPast: false,
  },

  // ============================================================================
  // Priority 75: "This [weekday]" expressions (FUTURE)
  // ============================================================================

  {
    id: 'this-weekday',
    pattern: new RegExp(`\\bthis\\s+(${WEEKDAY_PATTERN})\\b`, 'i'),
    extractor: (match, baseDate) => {
      const dayName = match[1].toLowerCase()
      const targetDay = WEEKDAY_MAP[dayName]
      if (targetDay === undefined) return { days: 0 }
      const days = getDaysUntilWeekday(targetDay, baseDate, false)
      return { days: days > 0 ? days : 0 }
    },
    labelGenerator: (match) => `This ${getWeekdayName(match[1])}`,
    confidence: 0.95,
    priority: 75,
    isPast: false,
  },

  // ============================================================================
  // Priority 70: "By/on [weekday]" expressions (FUTURE)
  // ============================================================================

  {
    id: 'by-weekday',
    pattern: new RegExp(`\\b(?:by|on|due)\\s+(${WEEKDAY_PATTERN})\\b`, 'i'),
    extractor: (match, baseDate) => {
      const dayName = match[1].toLowerCase()
      const targetDay = WEEKDAY_MAP[dayName]
      if (targetDay === undefined) return { days: 7 }
      const days = getDaysUntilWeekday(targetDay, baseDate, false)
      return { days }
    },
    labelGenerator: (match) => getWeekdayName(match[1]),
    confidence: 0.9,
    priority: 70,
    isPast: false,
  },

  // ============================================================================
  // Priority 65: Standalone weekday names (FUTURE, less certain)
  // Only match full weekday names to avoid false positives
  // ============================================================================

  {
    id: 'standalone-weekday',
    pattern: /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
    extractor: (match, baseDate) => {
      const dayName = match[1].toLowerCase()
      const targetDay = WEEKDAY_MAP[dayName]
      if (targetDay === undefined) return { days: 7 }
      const days = getDaysUntilWeekday(targetDay, baseDate, false)
      return { days }
    },
    labelGenerator: (match) => getWeekdayName(match[1]),
    confidence: 0.7,
    priority: 65,
    isPast: false,
  },

  // ============================================================================
  // Priority 60: End of period expressions (FUTURE)
  // ============================================================================

  {
    id: 'end-of-week',
    pattern: /\b(end\s+of\s+(the\s+)?week|eow)\b/i,
    extractor: (_, baseDate) => ({ days: getDaysUntilEndOfWeek(baseDate) }),
    labelGenerator: () => 'End of week',
    confidence: 1.0,
    priority: 60,
    isPast: false,
  },

  {
    id: 'end-of-month',
    pattern: /\b(end\s+of\s+(the\s+)?month|eom)\b/i,
    extractor: () => 'eom',
    labelGenerator: () => 'End of month',
    confidence: 1.0,
    priority: 60,
    isPast: false,
  },

  {
    id: 'end-of-day',
    pattern: /\b(end\s+of\s+(the\s+)?day|eod)\b/i,
    extractor: () => ({ days: 0 }),
    labelGenerator: () => 'End of day',
    confidence: 1.0,
    priority: 60,
    isPast: false,
  },

  // ============================================================================
  // Priority 50: "X days/weeks from now" expressions (FUTURE)
  // Supports both digits and text numbers
  // ============================================================================

  {
    id: 'n-days-from-now',
    pattern: new RegExp(`\\b${NUMBER_PATTERN}\\s*days?\\s+from\\s+now\\b`, 'i'),
    extractor: (match) => ({ days: parseNumber(match[1]) }),
    labelGenerator: (match) => {
      const n = parseNumber(match[1])
      return n === 1 ? '1 day from now' : `${n} days from now`
    },
    confidence: 1.0,
    priority: 50,
    isPast: false,
  },

  {
    id: 'n-weeks-from-now',
    pattern: new RegExp(`\\b${NUMBER_PATTERN}\\s*weeks?\\s+from\\s+now\\b`, 'i'),
    extractor: (match) => ({ weeks: parseNumber(match[1]) }),
    labelGenerator: (match) => {
      const n = parseNumber(match[1])
      return n === 1 ? '1 week from now' : `${n} weeks from now`
    },
    confidence: 1.0,
    priority: 50,
    isPast: false,
  },

  // ============================================================================
  // Priority 40: Informal expressions (FUTURE)
  // ============================================================================

  {
    id: 'asap',
    pattern: /\b(asap|a\.s\.a\.p\.)\b/i,
    extractor: () => ({ days: 0 }),
    labelGenerator: () => 'Today (ASAP)',
    confidence: 0.85,
    priority: 40,
    isPast: false,
  },

  {
    id: 'soon',
    pattern: /\b(soon)\b/i,
    extractor: () => ({ days: 3 }),
    labelGenerator: () => 'In 3 days (soon)',
    confidence: 0.6,
    priority: 40,
    isPast: false,
  },

  {
    id: 'later',
    pattern: /\b(later\s+this\s+week)\b/i,
    extractor: (_, baseDate) => {
      const daysUntilFriday = getDaysUntilWeekday(5, baseDate, false)
      return { days: Math.max(1, daysUntilFriday) }
    },
    labelGenerator: () => 'Later this week',
    confidence: 0.7,
    priority: 40,
    isPast: false,
  },

  // ============================================================================
  // Priority 30: PAST date expressions (lower priority, filtered by futureOnly)
  // ============================================================================

  {
    id: 'yesterday',
    pattern: /\b(yesterday)\b/i,
    extractor: () => ({ days: -1 }),
    labelGenerator: () => 'Yesterday',
    confidence: 1.0,
    priority: 30,
    isPast: true,
  },

  {
    id: 'n-days-ago',
    pattern: new RegExp(`\\b${NUMBER_PATTERN}\\s*days?\\s+ago\\b`, 'i'),
    extractor: (match) => ({ days: -parseNumber(match[1]) }),
    labelGenerator: (match) => {
      const n = parseNumber(match[1])
      return n === 1 ? '1 day ago' : `${n} days ago`
    },
    confidence: 1.0,
    priority: 30,
    isPast: true,
  },

  {
    id: 'n-weeks-ago',
    pattern: new RegExp(`\\b${NUMBER_PATTERN}\\s*weeks?\\s+ago\\b`, 'i'),
    extractor: (match) => ({ weeks: -parseNumber(match[1]) }),
    labelGenerator: (match) => {
      const n = parseNumber(match[1])
      return n === 1 ? '1 week ago' : `${n} weeks ago`
    },
    confidence: 1.0,
    priority: 30,
    isPast: true,
  },

  {
    id: 'n-months-ago',
    pattern: new RegExp(`\\b${NUMBER_PATTERN}\\s*months?\\s+ago\\b`, 'i'),
    extractor: (match) => ({ months: -parseNumber(match[1]) }),
    labelGenerator: (match) => {
      const n = parseNumber(match[1])
      return n === 1 ? '1 month ago' : `${n} months ago`
    },
    confidence: 1.0,
    priority: 30,
    isPast: true,
  },

  {
    id: 'last-week',
    pattern: /\b(last\s+week)\b/i,
    extractor: () => ({ weeks: -1 }),
    labelGenerator: () => 'Last week',
    confidence: 1.0,
    priority: 30,
    isPast: true,
  },

  {
    id: 'last-month',
    pattern: /\b(last\s+month)\b/i,
    extractor: () => ({ months: -1 }),
    labelGenerator: () => 'Last month',
    confidence: 1.0,
    priority: 30,
    isPast: true,
  },

  {
    id: 'last-year',
    pattern: /\b(last\s+year)\b/i,
    extractor: () => ({ years: -1 }),
    labelGenerator: () => 'Last year',
    confidence: 1.0,
    priority: 30,
    isPast: true,
  },

  {
    id: 'last-weekday',
    pattern: new RegExp(`\\blast\\s+(${WEEKDAY_PATTERN})\\b`, 'i'),
    extractor: (match, baseDate) => {
      const dayName = match[1].toLowerCase()
      const targetDay = WEEKDAY_MAP[dayName]
      if (targetDay === undefined) return { days: -7 }
      const currentDay = baseDate.getDay()
      let daysSince = currentDay - targetDay
      if (daysSince <= 0) daysSince += 7
      return { days: -daysSince }
    },
    labelGenerator: (match) => `Last ${getWeekdayName(match[1])}`,
    confidence: 1.0,
    priority: 30,
    isPast: true,
  },

  {
    id: 'the-other-day',
    pattern: /\b(the\s+other\s+day)\b/i,
    extractor: () => ({ days: -2 }),
    labelGenerator: () => '2 days ago',
    confidence: 0.7,
    priority: 25,
    isPast: true,
  },

  {
    id: 'recently',
    pattern: /\b(recently)\b/i,
    extractor: () => ({ days: -3 }),
    labelGenerator: () => '~3 days ago',
    confidence: 0.5,
    priority: 20,
    isPast: true,
  },
]

/**
 * Get patterns sorted by priority (descending)
 */
export function getSortedPatterns(): DatePattern[] {
  return [...DATE_PATTERNS].sort((a, b) => b.priority - a.priority)
}
