// packages/lib/src/settings/__tests__/backflush-exclusion.test.ts
//
// 111 Q14: `inventory.backflush` and `inventory.autoBuildFromOrders` are mutually exclusive.
// Turning one on turns the other off in the same write; a batch asking for both on is refused.
//
// The db double stores rows by key. `readOrganizationSettings` filters by key in memory, so the
// select can hand back every stored row and still answer correctly.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SETTINGS_CATALOG } from '../catalog'
import { batchUpdateOrganizationSettings, updateOrganizationSetting } from '../settings-service'

const ORG = 'org_1'
const BACKFLUSH = 'inventory.backflush'
const AUTO_BUILD = 'inventory.autoBuildFromOrders'

vi.mock('../../cache/invalidate', () => ({ onCacheEvent: async () => {} }))

const h = vi.hoisted(() => ({
  rows: new Map<string, unknown>(),
  writes: [] as Array<{ key: string; value: unknown }>,
}))

function chain(rows: unknown[]) {
  const promise = Promise.resolve(rows) as Promise<unknown[]> & Record<string, unknown>
  promise.where = () => promise
  promise.limit = () => promise
  return promise
}

const db = {
  select: () => ({
    from: () => chain([...h.rows].map(([key, value]) => ({ key, value }))),
  }),
  insert: () => ({
    values: (row: { key: string; value: unknown }) => ({
      onConflictDoUpdate: () => {
        h.rows.set(row.key, row.value)
        h.writes.push({ key: row.key, value: row.value })
        return Promise.resolve([])
      },
    }),
  }),
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
} as never

beforeEach(() => {
  h.rows = new Map()
  h.writes = []
})

describe('the catalog entry', () => {
  it('is an org-scoped switch, off by default, whose description states the exclusivity', () => {
    const config = SETTINGS_CATALOG[BACKFLUSH]
    expect(config.access).toBe('org')
    expect(config.fieldType).toBe('CHECKBOX')
    expect(config.defaultValue).toBe(false)
    expect(config.description).toMatch(/auto-build/i)
  })
})

describe('updateOrganizationSetting', () => {
  it('turning backflush on turns auto-build off', async () => {
    h.rows.set(AUTO_BUILD, true)
    await updateOrganizationSetting({ organizationId: ORG, key: BACKFLUSH, value: true, db })
    expect(h.rows.get(BACKFLUSH)).toBe(true)
    expect(h.rows.get(AUTO_BUILD)).toBe(false)
  })

  it('turning auto-build on turns backflush off, and still stamps the enablement', async () => {
    h.rows.set(BACKFLUSH, true)
    await updateOrganizationSetting({ organizationId: ORG, key: AUTO_BUILD, value: true, db })
    expect(h.rows.get(AUTO_BUILD)).toBe(true)
    expect(h.rows.get(BACKFLUSH)).toBe(false)
    expect(typeof h.rows.get('inventory.autoBuildEnabledAt')).toBe('string')
  })

  it('turning one off leaves the other alone', async () => {
    h.rows.set(AUTO_BUILD, false)
    await updateOrganizationSetting({ organizationId: ORG, key: BACKFLUSH, value: false, db })
    expect(h.writes.map((w) => w.key)).toEqual([BACKFLUSH])
  })

  it('writes the other switch off even when it had no row, so no door leaves the pair ambiguous', async () => {
    await updateOrganizationSetting({ organizationId: ORG, key: BACKFLUSH, value: true, db })
    expect(h.writes).toEqual([
      { key: BACKFLUSH, value: true },
      { key: AUTO_BUILD, value: false },
    ])
  })
})

describe('batchUpdateOrganizationSettings', () => {
  it('refuses a batch that asks for both on, writing nothing', async () => {
    await expect(
      batchUpdateOrganizationSettings({
        organizationId: ORG,
        settings: [
          { key: BACKFLUSH, value: true },
          { key: AUTO_BUILD, value: true },
        ],
        db,
      })
    ).rejects.toThrow(/cannot both be on/)
    expect(h.writes).toEqual([])
  })

  it('a batch turning one on turns the other off', async () => {
    h.rows.set(AUTO_BUILD, true)
    await batchUpdateOrganizationSettings({
      organizationId: ORG,
      settings: [
        { key: 'inventory.autoBuildStockRule', value: 'all_stock_levels' },
        { key: BACKFLUSH, value: true },
      ],
      db,
    })
    expect(h.rows.get(BACKFLUSH)).toBe(true)
    expect(h.rows.get(AUTO_BUILD)).toBe(false)
  })

  it('a batch with one on and the other explicitly off is fine', async () => {
    await batchUpdateOrganizationSettings({
      organizationId: ORG,
      settings: [
        { key: BACKFLUSH, value: false },
        { key: AUTO_BUILD, value: true },
      ],
      db,
    })
    expect(h.rows.get(AUTO_BUILD)).toBe(true)
    expect(h.rows.get(BACKFLUSH)).toBe(false)
  })
})
