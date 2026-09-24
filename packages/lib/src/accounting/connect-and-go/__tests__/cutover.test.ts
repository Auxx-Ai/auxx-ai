// packages/lib/src/accounting/connect-and-go/__tests__/cutover.test.ts

import { describe, expect, it } from 'vitest'
import { estimateDrainMinutes, proposeCutover } from '../cutover'

const today = new Date('2026-01-01T03:00:00Z')

describe('proposeCutover', () => {
  it('keeps a cutover already set', () => {
    expect(
      proposeCutover({
        currentCutoffPeriod: '2025-06',
        lockDate: '2025-12-31',
        bookTimeZone: null,
        today,
      })
    ).toEqual({ cutoffPeriod: '2025-06', source: 'current' })
  })

  it("takes the provider lock date's month", () => {
    expect(
      proposeCutover({
        currentCutoffPeriod: null,
        lockDate: '2025-10-15',
        bookTimeZone: null,
        today,
      })
    ).toEqual({ cutoffPeriod: '2025-10', source: 'lock_date' })
  })

  it('falls back to the last full month in the book zone', () => {
    // Still December 31 in New York, so the last full month is November.
    expect(
      proposeCutover({
        currentCutoffPeriod: null,
        lockDate: null,
        bookTimeZone: 'America/New_York',
        today,
      })
    ).toEqual({ cutoffPeriod: '2025-11', source: 'last_full_month' })
    expect(
      proposeCutover({ currentCutoffPeriod: null, lockDate: null, bookTimeZone: null, today })
    ).toEqual({ cutoffPeriod: '2025-12', source: 'last_full_month' })
  })
})

describe('estimateDrainMinutes', () => {
  it('is the slowest lane at 100 a minute', () => {
    expect(estimateDrainMinutes([15_000, 420, 0])).toBe(150)
    expect(estimateDrainMinutes([1])).toBe(1)
    expect(estimateDrainMinutes([])).toBe(0)
  })
})
