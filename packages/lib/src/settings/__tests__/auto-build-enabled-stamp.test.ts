// packages/lib/src/settings/__tests__/auto-build-enabled-stamp.test.ts
//
// AB8's enablement stamp (plans/products/12-order-triggered-build.md §4):
// flipping `inventory.autoBuildFromOrders` ON records the moment it happened in
// `inventory.autoBuildEnabledAt`, and the order-triggered build refuses every
// order placed before it.
//
// The db is a stand-in recording upserts. `src/test/setup.ts` mocks
// `@auxx/database` wholesale, so `schema.OrganizationSetting`'s columns are
// `undefined` and the double cannot read a `WHERE` — the fixture is one row, so
// "the row this select would return" is unambiguous.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SETTINGS_CATALOG } from '../catalog'
import { batchUpdateOrganizationSettings, updateOrganizationSetting } from '../settings-service'

const ORG = 'org_1'

interface Upsert {
  key: string
  value: unknown
  scope: string
}

const h = vi.hoisted(() => ({
  /** The one row a `select` returns, or `undefined` for "no row yet". */
  storedValue: undefined as unknown,
  upserts: [] as Upsert[],
}))

function chain(rows: unknown[]) {
  const promise = Promise.resolve(rows) as Promise<unknown[]> & Record<string, unknown>
  promise.where = () => promise
  promise.limit = () => promise
  return promise
}

const db = {
  select: () => ({
    from: () => chain(h.storedValue === undefined ? [] : [{ value: h.storedValue }]),
  }),
  insert: () => ({
    values: (row: Upsert) => ({
      onConflictDoUpdate: () => {
        h.upserts.push({ key: row.key, value: row.value, scope: row.scope })
        return Promise.resolve([])
      },
    }),
  }),
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
} as never

beforeEach(() => {
  vi.clearAllMocks()
  h.storedValue = undefined
  h.upserts = []
})

const stamps = () => h.upserts.filter((u) => u.key === 'inventory.autoBuildEnabledAt')

describe('the four catalog entries (§5.4)', () => {
  it('declares all four keys, org-scoped', () => {
    for (const key of [
      'inventory.autoBuildFromOrders',
      'inventory.autoBuildEnabledAt',
      'inventory.autoBuildStatus',
      'inventory.autoBuildStockRule',
    ] as const) {
      expect(SETTINGS_CATALOG[key].access).toBe('org')
    }
  })

  it('🛑 defaults to OFF, `out_of_stock_only` and `planned` (AB4/AB5)', () => {
    expect(SETTINGS_CATALOG['inventory.autoBuildFromOrders'].defaultValue).toBe(false)
    expect(SETTINGS_CATALOG['inventory.autoBuildEnabledAt'].defaultValue).toBeNull()
    expect(SETTINGS_CATALOG['inventory.autoBuildStockRule'].defaultValue).toBe('out_of_stock_only')
    expect(SETTINGS_CATALOG['inventory.autoBuildStatus'].defaultValue).toBe('planned')
  })

  it('offers `planned` alone until phase 4, and both stock rules today', () => {
    expect(SETTINGS_CATALOG['inventory.autoBuildStatus'].options?.options).toEqual([
      { value: 'planned', label: 'Planned' },
    ])
    expect(
      SETTINGS_CATALOG['inventory.autoBuildStockRule'].options?.options?.map((o) => o.value)
    ).toEqual(['out_of_stock_only', 'all_stock_levels'])
  })

  it('reuses GENERAL rather than the dead INVENTORY_BRIDGE scope', () => {
    // `INVENTORY_BRIDGE` is the scope of the v9 bridge deleted in #1941; naming
    // the bridge's replacement after the bridge would be worse than generic.
    for (const key of [
      'inventory.autoBuildFromOrders',
      'inventory.autoBuildEnabledAt',
      'inventory.autoBuildStatus',
      'inventory.autoBuildStockRule',
    ] as const) {
      expect(SETTINGS_CATALOG[key].scope).toBe('GENERAL')
    }
  })
})

describe('updateOrganizationSetting — the off→on stamp', () => {
  it('stamps `autoBuildEnabledAt` when the switch goes from unset to on', async () => {
    await updateOrganizationSetting({
      organizationId: ORG,
      key: 'inventory.autoBuildFromOrders',
      value: true,
      db,
    })

    expect(stamps()).toHaveLength(1)
    expect(typeof stamps()[0]?.value).toBe('string')
    expect(Number.isNaN(Date.parse(stamps()[0]?.value as string))).toBe(false)
  })

  it('stamps again when the switch is turned back on after being off', async () => {
    h.storedValue = false

    await updateOrganizationSetting({
      organizationId: ORG,
      key: 'inventory.autoBuildFromOrders',
      value: true,
      db,
    })

    // 🛑 A switch off for three months must not reopen those three months.
    expect(stamps()).toHaveLength(1)
  })

  it('🛑 does NOT re-stamp when the switch was already on', async () => {
    h.storedValue = true

    await updateOrganizationSetting({
      organizationId: ORG,
      key: 'inventory.autoBuildFromOrders',
      value: true,
      db,
    })

    // Re-saving an unchanged settings form must not move the cutoff forward and
    // silently skip every order placed since it was actually turned on.
    expect(stamps()).toEqual([])
  })

  it('does not stamp when the switch is turned OFF', async () => {
    h.storedValue = true

    await updateOrganizationSetting({
      organizationId: ORG,
      key: 'inventory.autoBuildFromOrders',
      value: false,
      db,
    })

    // The stamp is only read while the boolean is true, so leaving it is right.
    expect(stamps()).toEqual([])
  })

  it('never stamps for an unrelated key', async () => {
    await updateOrganizationSetting({
      organizationId: ORG,
      key: 'inventory.autoBuildStockRule',
      value: 'all_stock_levels',
      db,
    })

    expect(stamps()).toEqual([])
    expect(h.upserts.map((u) => u.key)).toEqual(['inventory.autoBuildStockRule'])
  })
})

describe('batchUpdateOrganizationSettings — the same stamp, same transaction', () => {
  it('stamps when the batch flips the switch on', async () => {
    await batchUpdateOrganizationSettings({
      organizationId: ORG,
      settings: [
        { key: 'inventory.autoBuildStockRule', value: 'out_of_stock_only' },
        { key: 'inventory.autoBuildFromOrders', value: true },
      ],
      db,
    })

    expect(stamps()).toHaveLength(1)
  })

  it('does not stamp when the batch leaves an already-on switch on', async () => {
    h.storedValue = true

    await batchUpdateOrganizationSettings({
      organizationId: ORG,
      settings: [{ key: 'inventory.autoBuildFromOrders', value: true }],
      db,
    })

    expect(stamps()).toEqual([])
  })
})

describe('validation', () => {
  it('refuses a stock rule the catalog does not offer', async () => {
    await expect(
      updateOrganizationSetting({
        organizationId: ORG,
        key: 'inventory.autoBuildStockRule',
        value: 'whatever',
        db,
      })
    ).rejects.toThrow(/expects one of/)
  })

  it('🛑 refuses `completed` as an auto-build status until phase 4 widens it', async () => {
    await expect(
      updateOrganizationSetting({
        organizationId: ORG,
        key: 'inventory.autoBuildStatus',
        value: 'completed',
        db,
      })
    ).rejects.toThrow(/expects one of/)
  })
})
