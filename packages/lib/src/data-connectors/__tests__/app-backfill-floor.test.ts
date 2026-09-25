// packages/lib/src/data-connectors/__tests__/app-backfill-floor.test.ts
// v13 N2 — the app backfill floor never passes an accounting-active org's cutover.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const accounting = { active: false, cutoverStart: null as Date | null }
vi.mock('../../accounting/ledger/setup/cutover-start', () => ({
  readActiveCutoverStart: async () => (accounting.active ? accounting.cutoverStart : null),
}))

import { appBackfillFloor } from '../slice-orchestrator'

const NOW = new Date('2026-09-24T12:00:00.000Z')

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  accounting.active = false
  accounting.cutoverStart = null
})
afterEach(() => vi.useRealTimers())

describe('appBackfillFloor', () => {
  it('has no floor for the full history', async () => {
    expect(await appBackfillFloor('org1', 'all')).toBeUndefined()
    expect(await appBackfillFloor('org1', undefined)).toBeUndefined()
  })

  it('is the span floor for an org without active accounting', async () => {
    accounting.cutoverStart = new Date('2025-10-01T07:00:00.000Z')
    const floor = await appBackfillFloor('org1', 'last_90_days')
    expect(Date.parse(floor!)).toBe(NOW.getTime() - 90 * 86_400_000)
  })

  it('floors at a year-old cutover for an accounting-active org on last 90 days', async () => {
    accounting.active = true
    accounting.cutoverStart = new Date('2025-10-01T07:00:00.000Z')
    expect(await appBackfillFloor('org1', 'last_90_days')).toBe('2025-10-01T07:00:00.000Z')
  })

  it('keeps the span floor when the cutover is later than it', async () => {
    accounting.active = true
    accounting.cutoverStart = new Date('2026-09-01T07:00:00.000Z')
    const floor = await appBackfillFloor('org1', 'last_90_days')
    expect(Date.parse(floor!)).toBe(NOW.getTime() - 90 * 86_400_000)
  })
})
