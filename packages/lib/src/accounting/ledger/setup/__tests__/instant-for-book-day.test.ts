// packages/lib/src/accounting/ledger/setup/__tests__/instant-for-book-day.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ zone: 'America/Los_Angeles' as string | null }))

vi.mock('../../../../settings/settings-service', () => ({
  getOrganizationSetting: async () => h.zone,
}))

import { instantForBookDay } from '../book-time-zone'

describe('instantForBookDay', () => {
  beforeEach(() => {
    // 2026-09-22 20:00 in Los Angeles, already the 23rd in UTC.
    vi.useFakeTimers({ now: new Date('2026-09-23T03:00:00.000Z'), toFake: ['Date'] })
    h.zone = 'America/Los_Angeles'
  })
  afterEach(() => vi.useRealTimers())

  it('is now when the day is today in the book zone', async () => {
    expect((await instantForBookDay('org_1', '2026-09-22')).toISOString()).toBe(
      '2026-09-23T03:00:00.000Z'
    )
  })

  it('is the start of a past day in the book zone', async () => {
    expect((await instantForBookDay('org_1', '2026-09-10')).toISOString()).toBe(
      '2026-09-10T07:00:00.000Z'
    )
  })

  it('reads east of UTC on the same day', async () => {
    h.zone = 'Europe/Berlin'
    expect((await instantForBookDay('org_1', '2026-09-10')).toISOString()).toBe(
      '2026-09-09T22:00:00.000Z'
    )
  })

  it('falls back to UTC when the setting is unset', async () => {
    h.zone = null
    expect((await instantForBookDay('org_1', '2026-09-10')).toISOString()).toBe(
      '2026-09-10T00:00:00.000Z'
    )
  })
})
