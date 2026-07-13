// apps/web/src/components/dispatch/ui/recurrence/recurrence-utils.ts

import type { RecurrencePattern, Weekday } from '@auxx/lib/recurrence/client'

/** Repeats-row selection (06-recurring-engine.md §6) — `'none'` = no rule / not touched. */
export type RecurrencePreset = 'none' | 'weekly' | 'biweekly' | 'monthly' | 'custom'

/**
 * A `SettingValue` read via `getSetting` may be a scalar or (defensively) a 1-item array —
 * mirrors `board/utils.ts:scalarSetting` (duplicated per the `board/types.ts` "read-only
 * mirror" precedent so this non-board component doesn't reach into `board/`).
 */
export function scalarSetting(value: unknown): string | null {
  if (Array.isArray(value)) return (value[0] as string) ?? null
  return (value as string) ?? null
}

/**
 * Classify an existing `RecurrencePattern` back into a Repeats preset, or `'custom'` when it
 * doesn't match one of the three canned shapes (multi-weekday, nth-weekday, or daily all fall
 * through to Custom). End conditions (`until`/`count`) no longer force Custom — the schedule
 * popover edits Ends independently of the preset via `RecurrenceEndFields`.
 */
export function classifyRecurrencePreset(pattern: RecurrencePattern | null): RecurrencePreset {
  if (!pattern) return 'none'
  if (pattern.frequency === 'weekly' && (pattern.weekdays?.length ?? 0) === 1) {
    if (pattern.interval === 1) return 'weekly'
    if (pattern.interval === 2) return 'biweekly'
    return 'custom'
  }
  if (pattern.frequency === 'monthly' && pattern.interval === 1 && pattern.monthDay != null) {
    return 'monthly'
  }
  return 'custom'
}

/** Preset → pattern, derived from the currently picked start date (06 §6 preset semantics). */
export function buildPresetPattern(
  preset: 'weekly' | 'biweekly' | 'monthly',
  date: Date
): RecurrencePattern {
  const weekday = date.getDay() as Weekday
  switch (preset) {
    case 'weekly':
      return { frequency: 'weekly', interval: 1, weekdays: [weekday] }
    case 'biweekly':
      return { frequency: 'weekly', interval: 2, weekdays: [weekday] }
    case 'monthly':
      return { frequency: 'monthly', interval: 1, monthDay: date.getDate() }
  }
}

/** Seed pattern for a freshly opened Custom editor with no prior rule to inherit from. */
export function defaultCustomPattern(date: Date | undefined): RecurrencePattern {
  const weekday = (date ?? new Date()).getDay() as Weekday
  return { frequency: 'weekly', interval: 1, weekdays: [weekday] }
}

/** Weekday indices (0-6) in display order, starting from the org's `weekStart` setting. */
export function orderedWeekdays(weekStartIndex: 0 | 1 | 6): Weekday[] {
  return Array.from({ length: 7 }, (_, i) => ((weekStartIndex + i) % 7) as Weekday)
}
