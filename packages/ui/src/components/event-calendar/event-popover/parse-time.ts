// packages/ui/src/components/event-calendar/event-popover/parse-time.ts

import { format } from 'date-fns'

export interface ParsedTime {
  hours: number
  minutes: number
}

const MERIDIEM_RE = /^(.*?)\s*(am|pm)$/i
const SEPARATOR_RE = /^(\d{1,2})[:.](\d{1,2})$/
const DIGITS_ONLY_RE = /^\d+$/

/**
 * Parses freeform time-of-day text: `'9'`, `'09'`, `'9:30'`, `'930'`, `'1430'`, `'2pm'`,
 * `'2:30pm'`, `'2.30'`, `'14:00'`, `'12am'` (→ 0h), `'12pm'` (→ 12h). Bare 3–4 digit numbers
 * are split heuristically (`'930'` → 9:30, `'1430'` → 14:30). Case-insensitive am/pm with an
 * optional space. Returns `null` for anything unparseable or out of range (hours > 23,
 * minutes > 59, a bare `'25'`).
 */
export function parseTimeInput(input: string): ParsedTime | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  const meridiemMatch = trimmed.match(MERIDIEM_RE)
  const meridiem = meridiemMatch?.[2]?.toLowerCase() as 'am' | 'pm' | undefined
  const body = (meridiemMatch?.[1] ?? trimmed).trim()
  if (!body) return null

  let hours: number
  let minutes: number

  const separatorMatch = body.match(SEPARATOR_RE)
  if (separatorMatch) {
    hours = Number(separatorMatch[1])
    minutes = Number(separatorMatch[2])
  } else if (DIGITS_ONLY_RE.test(body)) {
    if (body.length <= 2) {
      hours = Number(body)
      minutes = 0
    } else if (body.length === 3) {
      hours = Number(body.slice(0, 1))
      minutes = Number(body.slice(1))
    } else if (body.length === 4) {
      hours = Number(body.slice(0, 2))
      minutes = Number(body.slice(2))
    } else {
      return null
    }
  } else {
    return null
  }

  if (meridiem) {
    if (hours < 1 || hours > 12) return null
    hours = meridiem === 'am' ? (hours === 12 ? 0 : hours) : hours === 12 ? 12 : hours + 12
  }

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null

  return { hours, minutes }
}

/** Formats a time-of-day for display: `'14:00'` (24h) vs `'2:00 PM'` (12h, default). */
export function formatTimeOfDay(date: Date, use24Hour = false): string {
  return format(date, use24Hour ? 'HH:mm' : 'h:mm a')
}
