// apps/web/src/components/accounting/ui/ledger/sidebar/__tests__/next-fire.test.ts
//
// The "next" clause on a scheduled posting type's row (brief 28 §6). Both
// helpers are pure in `from` / `now`, which is what this file relies on: every
// assertion here is about a fixed instant, never the wall clock.

import { describe, expect, it } from 'vitest'
import { formatNextFire, nextFire } from '../next-fire'

// The payout sweep: `30 4 * * *` UTC (policy.ts).
const PAYOUT_CRON = '30 4 * * *'

describe('nextFire', () => {
  it('finds the next fire later the same UTC day', () => {
    const next = nextFire(PAYOUT_CRON, new Date('2026-09-14T01:00:00Z'))
    expect(next?.toISOString()).toBe('2026-09-14T04:30:00.000Z')
  })

  it('rolls to the next UTC day once the time has passed', () => {
    const next = nextFire(PAYOUT_CRON, new Date('2026-09-14T04:30:00Z'))
    expect(next?.toISOString()).toBe('2026-09-15T04:30:00.000Z')
  })

  it('evaluates the pattern in UTC regardless of where the viewer sits', () => {
    // 23:00 in New York on the 13th is 03:00 UTC on the 14th: still before 04:30.
    const next = nextFire(PAYOUT_CRON, new Date('2026-09-13T23:00:00-04:00'))
    expect(next?.toISOString()).toBe('2026-09-14T04:30:00.000Z')
  })

  it('answers null for a pattern it cannot parse', () => {
    expect(nextFire('not a cron', new Date('2026-09-14T01:00:00Z'))).toBeNull()
  })
})

describe('formatNextFire', () => {
  const now = new Date('2026-09-14T01:00:00Z')

  it('says today when the fire is later on the same UTC date', () => {
    expect(formatNextFire(new Date('2026-09-14T04:30:00Z'), now)).toBe('today 04:30 UTC')
  })

  it('says tomorrow for the next UTC date', () => {
    expect(formatNextFire(new Date('2026-09-15T04:30:00Z'), now)).toBe('tomorrow 04:30 UTC')
  })

  it('names the date beyond that', () => {
    expect(formatNextFire(new Date('2026-09-20T03:45:00Z'), now)).toBe('Sep 20, 03:45 UTC')
  })

  it('judges the day in UTC, not in the viewer zone', () => {
    // 22:00 UTC on the 14th; a New York viewer's clock still says the 14th too,
    // but a Tokyo viewer's says the 15th. The word is the same for both.
    const late = new Date('2026-09-14T22:00:00Z')
    expect(formatNextFire(new Date('2026-09-15T04:30:00Z'), late)).toBe('tomorrow 04:30 UTC')
  })
})
