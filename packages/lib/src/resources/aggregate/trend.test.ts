// packages/lib/src/resources/aggregate/trend.test.ts

import { describe, expect, it } from 'vitest'
import { deriveTrendWindows } from './trend'

describe('deriveTrendWindows', () => {
  it('previousPeriod = same-length window immediately before', () => {
    const from = new Date('2026-07-01T00:00:00.000Z')
    const to = new Date('2026-07-08T00:00:00.000Z')
    const windows = deriveTrendWindows({ from, to }, 'previousPeriod', 'UTC')
    expect(windows?.previous.from.toISOString()).toBe('2026-06-24T00:00:00.000Z')
    expect(windows?.previous.to.toISOString()).toBe('2026-07-01T00:00:00.000Z')
    expect(windows?.current.from).toBe(from)
  })

  it('samePeriodLastYear shifts by one LOCAL year across a DST offset change', () => {
    // Jul 1 2026 00:00 New York (EDT, UTC-4)
    const from = new Date('2026-07-01T04:00:00.000Z')
    const to = new Date('2026-08-01T04:00:00.000Z')
    const windows = deriveTrendWindows({ from, to }, 'samePeriodLastYear', 'America/New_York')
    // Jul 1 2025 00:00 New York is also EDT — same local wall time.
    expect(windows?.previous.from.toISOString()).toBe('2025-07-01T04:00:00.000Z')
    expect(windows?.previous.to.toISOString()).toBe('2025-08-01T04:00:00.000Z')
  })

  it('returns undefined for unbounded or degenerate windows', () => {
    const from = new Date('2026-07-01T00:00:00.000Z')
    expect(deriveTrendWindows({}, 'previousPeriod', 'UTC')).toBeUndefined()
    expect(deriveTrendWindows({ from }, 'previousPeriod', 'UTC')).toBeUndefined()
    expect(deriveTrendWindows({ from, to: from }, 'previousPeriod', 'UTC')).toBeUndefined()
  })
})
