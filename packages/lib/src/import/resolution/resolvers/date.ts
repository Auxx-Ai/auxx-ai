// packages/lib/src/import/resolution/resolvers/date.ts

import { isValid, parse, parseISO } from 'date-fns'
import type { ResolutionConfig, ResolvedValue } from '../../types/resolution'

/**
 * Resolve ISO date string (YYYY-MM-DD).
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

  return { type: 'value', value: parsed }
}

/**
 * Resolve date with custom format.
 */
export function resolveDateCustom(rawValue: string, config: ResolutionConfig): ResolvedValue {
  const trimmed = rawValue.trim()

  if (!trimmed) {
    return { type: 'value', value: null }
  }

  const format = config.dateFormat
  if (!format) {
    return { type: 'error', error: 'Date format not configured' }
  }

  const parsed = parse(trimmed, format, new Date())

  if (!isValid(parsed)) {
    return { type: 'error', error: `Invalid date for format ${format}: ${rawValue}` }
  }

  return { type: 'value', value: parsed }
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

  const format = config.timestampFormat || config.dateFormat
  if (!format) {
    return { type: 'error', error: 'Datetime format not configured' }
  }

  const parsed = parse(trimmed, format, new Date())

  if (!isValid(parsed)) {
    return { type: 'error', error: `Invalid datetime for format ${format}: ${rawValue}` }
  }

  return { type: 'value', value: parsed }
}
