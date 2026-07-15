// packages/lib/src/dispatch/digest.test.ts
//
// Hour-bucket math for the worker daily digest (plans/dispatch/19-client-notifications.md
// §4.9) — pure functions, no DB/Redis involved. `isDigestHourBucket`/`localDateKey` are what
// `runDispatchDigestSweep` uses to decide, per org per hourly tick, whether "now" is the local
// 06:00 bucket and which calendar day to dedupe against.

import { describe, expect, it } from 'vitest'
import { DEFAULT_DIGEST_HOUR, isDigestHourBucket, localDateKey, localHourNow } from './digest'

describe('localHourNow', () => {
  it('reads the local hour in a non-UTC timezone', () => {
    // 2026-07-14T11:00:00Z in America/Chicago (CDT, UTC-5) is 06:00 local.
    expect(localHourNow('America/Chicago', new Date('2026-07-14T11:00:00Z'))).toBe(6)
  })

  it('reads the local hour in UTC', () => {
    expect(localHourNow('UTC', new Date('2026-07-14T06:00:00Z'))).toBe(6)
  })
})

describe('isDigestHourBucket', () => {
  it('is true exactly at the digest hour (default 06:00 local)', () => {
    // America/Chicago, CDT (UTC-5): 11:00 UTC -> 06:00 local.
    expect(
      isDigestHourBucket('America/Chicago', DEFAULT_DIGEST_HOUR, new Date('2026-07-14T11:00:00Z'))
    ).toBe(true)
  })

  it('is false the hour before', () => {
    // 10:00 UTC -> 05:00 local.
    expect(
      isDigestHourBucket('America/Chicago', DEFAULT_DIGEST_HOUR, new Date('2026-07-14T10:00:00Z'))
    ).toBe(false)
  })

  it('is false the hour after', () => {
    // 12:00 UTC -> 07:00 local.
    expect(
      isDigestHourBucket('America/Chicago', DEFAULT_DIGEST_HOUR, new Date('2026-07-14T12:00:00Z'))
    ).toBe(false)
  })

  it('respects a custom digest hour', () => {
    // 15:00 UTC -> 10:00 local (America/Chicago, CDT).
    expect(isDigestHourBucket('America/Chicago', 10, new Date('2026-07-14T15:00:00Z'))).toBe(true)
    expect(isDigestHourBucket('America/Chicago', 6, new Date('2026-07-14T15:00:00Z'))).toBe(false)
  })

  it('fires independently per timezone for the same UTC instant', () => {
    // 11:00 UTC is 06:00 in America/Chicago (CDT, UTC-5) but 13:00 in UTC itself and
    // 20:00 in Asia/Tokyo (UTC+9) — only the org actually AT local 06:00 should fire.
    const instant = new Date('2026-07-14T11:00:00Z')
    expect(isDigestHourBucket('America/Chicago', DEFAULT_DIGEST_HOUR, instant)).toBe(true)
    expect(isDigestHourBucket('UTC', DEFAULT_DIGEST_HOUR, instant)).toBe(false)
    expect(isDigestHourBucket('Asia/Tokyo', DEFAULT_DIGEST_HOUR, instant)).toBe(false)
  })

  it("stays unambiguous at the default 06:00 digest hour on America/New_York's fall-back day", () => {
    // 2026-11-01 is America/New_York's fall-back day, but the transition itself happens at
    // 2:00 AM EDT -> 1:00 AM EST — only the 1:00-2:00 AM wall-clock hour repeats. 06:00 local
    // (the default digest hour) is well past the transition, so exactly one UTC instant maps
    // to it: 11:00 UTC (EST, UTC-5). The hour before (10:00 UTC) is still 05:00 EST local.
    expect(isDigestHourBucket('America/New_York', 6, new Date('2026-11-01T10:00:00Z'))).toBe(false)
    expect(isDigestHourBucket('America/New_York', 6, new Date('2026-11-01T11:00:00Z'))).toBe(true)
    expect(isDigestHourBucket('America/New_York', 6, new Date('2026-11-01T12:00:00Z'))).toBe(false)
  })

  it('demonstrates the genuinely repeated wall-clock hour on fall-back (1:00-2:00 AM local)', () => {
    // The ACTUAL repeated hour: 05:00 UTC (still EDT, UTC-4 -> 01:00 local) and 06:00 UTC
    // (already EST, UTC-5 -> 01:00 local) both resolve to local hour 1. A digest configured
    // for hour 1 (hypothetical) would see this bucket twice in one day — which is exactly why
    // `runDispatchDigestSweep` also claims a per-org/day Redis marker instead of relying on
    // the hour-bucket check alone.
    expect(isDigestHourBucket('America/New_York', 1, new Date('2026-11-01T05:00:00Z'))).toBe(true)
    expect(isDigestHourBucket('America/New_York', 1, new Date('2026-11-01T06:00:00Z'))).toBe(true)
  })
})

describe('localDateKey', () => {
  it('renders the local calendar date, not the UTC one', () => {
    // 2026-07-15T02:00:00Z is 2026-07-14 21:00 in America/Chicago (CDT, UTC-5) — a day
    // earlier locally than the UTC date.
    expect(localDateKey('America/Chicago', new Date('2026-07-15T02:00:00Z'))).toBe('2026-07-14')
  })

  it('matches the UTC date in the UTC timezone', () => {
    expect(localDateKey('UTC', new Date('2026-07-14T06:00:00Z'))).toBe('2026-07-14')
  })
})
