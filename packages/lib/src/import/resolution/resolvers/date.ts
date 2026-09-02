// packages/lib/src/import/resolution/resolvers/date.ts

import { format, isValid, parse, parseISO } from 'date-fns'
import type { ResolutionConfig, ResolvedValue } from '../../types/resolution'

/** A `T` or space followed by a digit: the cell carries a time-of-day. */
const HAS_TIME_PART = /[T ]\d/

/**
 * The calendar day a parsed `Date` names, as a bare `YYYY-MM-DD`.
 *
 * date-fns parsers return the typed day at HOST-local midnight, and freezing
 * that instant into the resolution row made an imported day depend on where
 * the worker ran (UTC in prod, Pacific on a laptop). `format` reads the local
 * fields back, which is exactly the day the cell said, in every zone. The
 * write funnel turns the bare day into the canonical UTC midnight.
 */
function toCalendarDay(parsed: Date): string {
  return format(parsed, 'yyyy-MM-dd')
}

/**
 * Resolve ISO date string (YYYY-MM-DD).
 *
 * Emits a bare day. `date:iso` is also offered on DATETIME targets, so a cell
 * that carries a time (`2026-05-10T14:30:00Z`) keeps it as a full ISO instant;
 * on a DATE target the write funnel rounds that to the nearest UTC midnight.
 */
export function resolveDateIso(rawValue: string, _config: ResolutionConfig): ResolvedValue {
  const trimmed = rawValue.trim()

  if (!trimmed) {
    return { type: 'value', value: null }
  }

  const parsed = parseISO(trimmed)

  if (!isValid(parsed)) {
    return { type: 'error', error: `Invalid ISO date: ${rawValue}` }
  }

  if (HAS_TIME_PART.test(trimmed)) {
    return { type: 'value', value: parsed.toISOString() }
  }

  return { type: 'value', value: toCalendarDay(parsed) }
}

/**
 * Resolve date with custom format. Emits a bare `YYYY-MM-DD`.
 */
export function resolveDateCustom(rawValue: string, config: ResolutionConfig): ResolvedValue {
  const trimmed = rawValue.trim()

  if (!trimmed) {
    return { type: 'value', value: null }
  }

  const pattern = config.dateFormat
  if (!pattern) {
    return { type: 'error', error: 'Date format not configured' }
  }

  const parsed = parse(trimmed, pattern, new Date())

  if (!isValid(parsed)) {
    return { type: 'error', error: `Invalid date for format ${pattern}: ${rawValue}` }
  }

  return { type: 'value', value: toCalendarDay(parsed) }
}

/**
 * Resolve ISO datetime string.
 */
export function resolveDatetimeIso(rawValue: string, _config: ResolutionConfig): ResolvedValue {
  const trimmed = rawValue.trim()

  if (!trimmed) {
    return { type: 'value', value: null }
  }

  const parsed = parseISO(trimmed)

  if (!isValid(parsed)) {
    return { type: 'error', error: `Invalid ISO datetime: ${rawValue}` }
  }

  return { type: 'value', value: parsed }
}

/**
 * Resolve datetime with custom format.
 */
export function resolveDatetimeCustom(rawValue: string, config: ResolutionConfig): ResolvedValue {
  const trimmed = rawValue.trim()

  if (!trimmed) {
    return { type: 'value', value: null }
  }

  const pattern = config.timestampFormat || config.dateFormat
  if (!pattern) {
    return { type: 'error', error: 'Datetime format not configured' }
  }

  const parsed = parse(trimmed, pattern, new Date())

  if (!isValid(parsed)) {
    return { type: 'error', error: `Invalid datetime for format ${pattern}: ${rawValue}` }
  }

  return { type: 'value', value: parsed }
}
