// packages/lib/src/workflow-engine/query-builder/relative-date-range.test.ts

import { describe, expect, it } from 'vitest'
import { resolveOlderThanCutoff, resolveRelativeDateRange } from './relative-date-range'

// Wednesday 2026-05-13 14:30:00 local time
const NOW = new Date(2026, 4, 13, 14, 30, 0, 0)

describe('resolveRelativeDateRange', () => {
  it('today: covers [start of day, start of next day)', () => {
    const range = resolveRelativeDateRange('today', null, NOW)
    expect(range).not.toBeNull()
    expect(range!.start).toEqual(new Date(2026, 4, 13, 0, 0, 0, 0))
    expect(range!.end).toEqual(new Date(2026, 4, 14, 0, 0, 0, 0))
  })

  it('yesterday: covers prior calendar day', () => {
    const range = resolveRelativeDateRange('yesterday', null, NOW)
    expect(range!.start).toEqual(new Date(2026, 4, 12, 0, 0, 0, 0))
    expect(range!.end).toEqual(new Date(2026, 4, 13, 0, 0, 0, 0))
  })

  it('this_week: starts Sunday, spans 7 days (matches evaluate.ts)', () => {
    // 2026-05-13 is Wednesday → week starts 2026-05-10 (Sunday)
    const range = resolveRelativeDateRange('this_week', null, NOW)
    expect(range!.start).toEqual(new Date(2026, 4, 10, 0, 0, 0, 0))
    expect(range!.end).toEqual(new Date(2026, 4, 17, 0, 0, 0, 0))
  })

  it('this_month: spans the calendar month', () => {
    const range = resolveRelativeDateRange('this_month', null, NOW)
    expect(range!.start).toEqual(new Date(2026, 4, 1, 0, 0, 0, 0))
    expect(range!.end).toEqual(new Date(2026, 5, 1, 0, 0, 0, 0))
  })

  it('within_days: spans [now - days, now + 1ms)', () => {
    const range = resolveRelativeDateRange('within_days', 7, NOW)
    expect(range!.start.getTime()).toBe(NOW.getTime() - 7 * 86_400_000)
    expect(range!.end.getTime()).toBe(NOW.getTime() + 1)
  })

  it('within_days: returns null for non-numeric value', () => {
    expect(resolveRelativeDateRange('within_days', 'abc', NOW)).toBeNull()
    expect(resolveRelativeDateRange('within_days', null, NOW)).toBeNull()
  })

  it('returns null for non-relative operators', () => {
    expect(resolveRelativeDateRange('is', null, NOW)).toBeNull()
    expect(resolveRelativeDateRange('older_than_days', 5, NOW)).toBeNull()
  })
})

describe('resolveOlderThanCutoff', () => {
  it('returns now - days', () => {
    const cutoff = resolveOlderThanCutoff(7, NOW)
    expect(cutoff!.getTime()).toBe(NOW.getTime() - 7 * 86_400_000)
  })

  it('returns null for invalid input', () => {
    expect(resolveOlderThanCutoff('abc', NOW)).toBeNull()
    expect(resolveOlderThanCutoff(null, NOW)).toBeNull()
  })
})
