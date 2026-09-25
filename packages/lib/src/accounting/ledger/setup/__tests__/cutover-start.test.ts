// packages/lib/src/accounting/ledger/setup/__tests__/cutover-start.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const settings: Record<string, unknown> = {}
const accounting = { active: true }
vi.mock('../../../../settings/read', () => ({
  readOrganizationSettings: async (_org: string, keys: readonly string[]) =>
    Object.fromEntries(keys.map((key) => [key, settings[key] ?? null])),
}))
vi.mock('../accounting-enabled', () => ({ isAccountingActive: async () => accounting.active }))

import { readActiveCutoverStart, readCutoverStart } from '../cutover-start'

beforeEach(() => {
  for (const key of Object.keys(settings)) delete settings[key]
  accounting.active = true
})

describe('readCutoverStart', () => {
  it('is midnight after the cutover date, in the book time zone', async () => {
    settings['accounting.cutoffPeriod'] = '2025-12'
    settings['accounting.bookTimeZone'] = 'America/Los_Angeles'
    expect((await readCutoverStart('org1'))?.toISOString()).toBe('2026-01-01T08:00:00.000Z')
  })

  it('falls back to UTC with no book time zone', async () => {
    settings['accounting.cutoffPeriod'] = '2024-02'
    expect((await readCutoverStart('org1'))?.toISOString()).toBe('2024-03-01T00:00:00.000Z')
  })

  it('is null with no cutoff month', async () => {
    expect(await readCutoverStart('org1')).toBeNull()
  })

  it('refuses a day-granular cutoff', async () => {
    settings['accounting.cutoffPeriod'] = '2025-12-31'
    await expect(readCutoverStart('org1')).rejects.toThrow(/has to be a YYYY-MM month/)
  })
})

describe('readActiveCutoverStart', () => {
  it('is null unless accounting is active', async () => {
    settings['accounting.cutoffPeriod'] = '2025-12'
    expect(await readActiveCutoverStart('org1')).toBeInstanceOf(Date)
    accounting.active = false
    expect(await readActiveCutoverStart('org1')).toBeNull()
  })
})
