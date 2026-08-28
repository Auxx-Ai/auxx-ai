// packages/lib/src/builds/__tests__/auto-build-settings.test.ts
//
// The seam between the settings catalog and the auto-build policy: which four
// keys are read, and how their stored shapes become the trigger's inputs
// (plans/products/12-order-triggered-build.md §5.4).

import { beforeEach, describe, expect, it, vi } from 'vitest'

const ORG = 'org_1'

const h = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  keysRead: [] as string[],
}))

vi.mock('../../settings/settings-service', () => ({
  getOrganizationSetting: vi.fn(async ({ key }: { key: string }) => {
    h.keysRead.push(key)
    return h.values.has(key) ? h.values.get(key) : null
  }),
}))

import { loadAutoBuildSettings } from '../auto-build-settings'

beforeEach(() => {
  vi.clearAllMocks()
  h.values = new Map()
  h.keysRead = []
})

describe('loadAutoBuildSettings', () => {
  it('reads exactly the four `inventory.autoBuild*` keys', async () => {
    await loadAutoBuildSettings(ORG)
    expect(h.keysRead.sort()).toEqual([
      'inventory.autoBuildEnabledAt',
      'inventory.autoBuildFromOrders',
      'inventory.autoBuildStatus',
      'inventory.autoBuildStockRule',
    ])
  })

  it('reads an unconfigured org as OFF, with the safe stock rule and no stamp', async () => {
    expect(await loadAutoBuildSettings(ORG)).toEqual({
      enabled: false,
      enabledAt: null,
      status: 'planned',
      stockRule: 'out_of_stock_only',
    })
  })

  it('turns the stored ISO stamp into a Date', async () => {
    h.values.set('inventory.autoBuildFromOrders', true)
    h.values.set('inventory.autoBuildEnabledAt', '2026-08-27T10:00:00.000Z')
    h.values.set('inventory.autoBuildStockRule', 'all_stock_levels')

    expect(await loadAutoBuildSettings(ORG)).toEqual({
      enabled: true,
      enabledAt: new Date('2026-08-27T10:00:00.000Z'),
      status: 'planned',
      stockRule: 'all_stock_levels',
    })
  })

  it('treats a non-boolean stored switch as off', async () => {
    h.values.set('inventory.autoBuildFromOrders', 'yes')
    expect((await loadAutoBuildSettings(ORG)).enabled).toBe(false)
  })
})
