// packages/lib/src/data-migrations/migrations/__tests__/181-rewalk-provisioned-chart-packs.test.ts
//
// 181 is retired: a data migration never creates chart accounts (MK, 2026-09-22).
// What is pinned is that it stays registered under its id and does nothing.

import type { Database } from '@auxx/database'
import { describe, expect, it, vi } from 'vitest'
import type { Migration181Result } from '../181-rewalk-provisioned-chart-packs'

const seedChartPacks = vi.fn()
vi.mock('../../../seed/gl-account-chart', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  seedChartPacks,
}))

const { migration181RewalkProvisionedChartPacks } = await import(
  '../181-rewalk-provisioned-chart-packs'
)
const { ALL_DATA_MIGRATIONS, PER_ORG_MIGRATIONS } = await import('../../registry')

const MIGRATION_ID = '181-rewalk-provisioned-chart-packs'

const runUp = () =>
  migration181RewalkProvisionedChartPacks.up(
    {} as Database,
    'org_1'
  ) as unknown as Promise<Migration181Result>

describe('migration 181 registration', () => {
  it('is registered exactly once, with the id the module exports', () => {
    const ids = PER_ORG_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === MIGRATION_ID)).toHaveLength(1)
    expect(migration181RewalkProvisionedChartPacks.id).toBe(MIGRATION_ID)
  })

  it('is the only migration claiming the number 181, and the registry stays sorted', () => {
    const ids = ALL_DATA_MIGRATIONS.map((m) => m.id)
    const numbers = ids.map((id) => id.split('-')[0])
    expect(numbers.filter((n) => n === '181')).toHaveLength(1)
    expect(new Set(ids).size).toBe(ids.length)
    expect([...ids]).toEqual([...ids].sort((a, b) => a.localeCompare(b)))
  })
})

describe('migration 181 up()', () => {
  it('creates nothing and never touches the chart walker', async () => {
    const result = await runUp()

    expect(result.alreadyUpToDate).toBe(true)
    expect(result.packsRewalked).toEqual([])
    expect(result.accountsCreated).toBe(0)
    expect(result.rolesAssigned).toBe(0)
    expect(seedChartPacks).not.toHaveBeenCalled()
  })
})
