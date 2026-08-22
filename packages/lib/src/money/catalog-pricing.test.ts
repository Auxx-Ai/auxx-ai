// packages/lib/src/money/catalog-pricing.test.ts
// Plan 17 §2/§3 — part cost sync + markup pricing. Mirrors the harness style of
// `field-hooks/post/bom-cost-triggers.test.ts`: mock `@auxx/database` with a sequential
// result queue (queries run in a deterministic order per call) and the cache/field-value/
// realtime seams, then assert on the hook-free writer's calls rather than on drizzle
// column identity (drizzle column refs can read as `undefined` under vitest).

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  queryQueue: [] as unknown[][],
  /** One entry per `.innerJoin(table, on)` call: `{ table, on, where }` (where filled on execution). */
  joins: [] as Array<{ table: unknown; on: unknown; where: unknown }>,
  setValueWithType: vi.fn(async (_ctx: unknown, _params: unknown) => [] as unknown[]),
  createFieldValueContext: vi.fn((organizationId: string) => ({ organizationId })),
  getRealtimeService: vi.fn(() => ({})),
  publishFieldValueUpdates: vi.fn(async (_svc: unknown, _orgId: string, _entries: unknown[]) => {}),
  bySystemAttributes: vi.fn(),
  bySystemAttribute: vi.fn(),
  requireCachedEntityDefId: vi.fn(async () => 'catalog_item_def'),
}))

function nextRows(): unknown[] {
  return h.queryQueue.shift() ?? []
}

vi.mock('@auxx/database', () => ({
  database: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(nextRows()),
        innerJoin: (table: unknown, on: unknown) => {
          const join = { table, on, where: undefined as unknown }
          h.joins.push(join)
          return {
            where: (clause: unknown) => {
              join.where = clause
              return Promise.resolve(nextRows())
            },
          }
        },
      }),
    }),
  },
  schema: {
    FieldValue: {
      entityId: 'entityId',
      fieldId: 'fieldId',
      relatedEntityId: 'relatedEntityId',
      organizationId: 'organizationId',
      valueNumber: 'valueNumber',
      valueBoolean: 'valueBoolean',
    },
    EntityInstance: {
      id: 'ei.id',
      organizationId: 'ei.organizationId',
      archivedAt: 'ei.archivedAt',
    },
  },
}))

vi.mock('../cache', () => ({
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: h.bySystemAttributes,
      bySystemAttribute: h.bySystemAttribute,
    }),
  }),
  requireCachedEntityDefId: h.requireCachedEntityDefId,
}))

vi.mock('../field-values/field-value-helpers', () => ({
  createFieldValueContext: h.createFieldValueContext,
}))

vi.mock('../field-values/field-value-mutations', () => ({
  setValueWithType: h.setValueWithType,
}))

vi.mock('../realtime', () => ({
  getRealtimeService: h.getRealtimeService,
  publishFieldValueUpdates: h.publishFieldValueUpdates,
}))

import { schema } from '@auxx/database'
import type { EntityFieldChangeEvent } from '../field-hooks/types'
import {
  computeMarkupPrice,
  pauseMarkupOnPriceEdit,
  recomputePriceOnMarkupChange,
  shouldPauseMarkup,
  syncCatalogCostOnPartChange,
  syncCatalogItemPricing,
} from './catalog-pricing'

const ALL_CATALOG_FIELDS = {
  catalog_item_part: { id: 'f_part', type: 'RELATIONSHIP' },
  catalog_item_cost: { id: 'f_cost', type: 'CURRENCY' },
  catalog_item_markup: { id: 'f_markup', type: 'NUMBER' },
  catalog_item_default_unit_price: { id: 'f_price', type: 'CURRENCY' },
  catalog_item_active: { id: 'f_active', type: 'CHECKBOX' },
}

/** Queue entries for `isCatalogItemSyncable` (the single-item hook guard): instance row, then active FieldValue row. */
const SYNCABLE_GUARD_ROWS: unknown[][] = [
  [{ archivedAt: null }], // EntityInstance exists, not archived
  [], // no stored catalog_item_active row — absence means active
]

/** Recursively search a mocked drizzle SQL clause for a mock column-name string. */
function clauseContains(value: unknown, needle: string, seen = new Set<object>()): boolean {
  if (typeof value === 'string') return value === needle
  if (value == null || typeof value !== 'object') return false
  if (seen.has(value)) return false
  seen.add(value)
  return Object.values(value).some((inner) => clauseContains(inner, needle, seen))
}

function buildEvent(overrides: Record<string, unknown>): EntityFieldChangeEvent {
  return {
    recordId: 'catalog_item:cat1',
    entityDefinitionId: 'catalog_item_def',
    entityType: null,
    entitySlug: 'catalog-items',
    field: { id: 'f_part', type: 'RELATIONSHIP', systemAttribute: 'catalog_item_part' },
    oldValue: null,
    newValue: null,
    oldDisplay: null,
    newDisplay: null,
    organizationId: 'org_1',
    userId: 'user_1',
    ...overrides,
  } as unknown as EntityFieldChangeEvent
}

beforeEach(() => {
  vi.clearAllMocks()
  h.queryQueue = []
  h.joins = []
  h.bySystemAttributes.mockResolvedValue(ALL_CATALOG_FIELDS)
  h.bySystemAttribute.mockResolvedValue({ id: 'f_partcost', type: 'CURRENCY' })
})

// ─── Pure math ───────────────────────────────────────────────────────

describe('computeMarkupPrice', () => {
  it('applies a 50% markup and rounds to a whole cent', () => {
    expect(computeMarkupPrice(320, 50)).toBe(480)
  })

  it('returns cost unchanged at 0% markup', () => {
    expect(computeMarkupPrice(1000, 0)).toBe(1000)
  })

  it('doubles cost at 100% markup', () => {
    expect(computeMarkupPrice(500, 100)).toBe(1000)
  })

  it('rounds fractional cents (round-half-up)', () => {
    // 333 * 1.15 = 382.95 → 383
    expect(computeMarkupPrice(333, 15)).toBe(383)
  })
})

describe('shouldPauseMarkup', () => {
  it('does not pause when the new price matches the computed auto price', () => {
    expect(shouldPauseMarkup(computeMarkupPrice(500, 50), 500, 50)).toBe(false)
  })

  it('pauses when the new price differs from the computed auto price', () => {
    expect(shouldPauseMarkup(999, 500, 50)).toBe(true)
  })

  it('pauses when there is no cost basis to compare against', () => {
    expect(shouldPauseMarkup(750, null, 50)).toBe(true)
  })

  it('pauses when the price was cleared entirely', () => {
    expect(shouldPauseMarkup(null, 500, 50)).toBe(true)
  })
})

// ─── Sync engine (§2) ────────────────────────────────────────────────

describe('syncCatalogItemPricing', () => {
  it('returns immediately for an empty changedPartIds array (no cache/DB calls)', async () => {
    await syncCatalogItemPricing('org_1', [])
    expect(h.bySystemAttributes).not.toHaveBeenCalled()
  })

  it('logs and returns when the pricing fields are not migrated yet', async () => {
    h.bySystemAttributes.mockResolvedValue({
      catalog_item_part: null,
      catalog_item_cost: null,
      catalog_item_markup: null,
      catalog_item_default_unit_price: null,
    })
    await syncCatalogItemPricing('org_1', ['part1'])
    expect(h.setValueWithType).not.toHaveBeenCalled()
  })

  it('runs exactly ONE query and writes nothing when no catalog item is linked', async () => {
    h.queryQueue = [[]] // linkRows query → nothing linked
    await syncCatalogItemPricing('org_1', ['part1'])
    expect(h.setValueWithType).not.toHaveBeenCalled()
    expect(h.requireCachedEntityDefId).not.toHaveBeenCalled()
  })

  it('updates cost on both linked items but price ONLY on the one with a markup set', async () => {
    h.queryQueue = [
      // linkRows: two catalog items both backed by part1
      [
        { catalogInstanceId: 'cat1', partInstanceId: 'part1' },
        { catalogInstanceId: 'cat2', partInstanceId: 'part1' },
      ],
      // part costs: part1's new landed cost is 500
      [{ entityId: 'part1', valueNumber: 500 }],
      // current values: cat1 has no markup, cat2 has markup=50 and a stale price
      [
        { entityId: 'cat1', fieldId: 'f_cost', valueNumber: 300 },
        { entityId: 'cat2', fieldId: 'f_cost', valueNumber: 300 },
        { entityId: 'cat2', fieldId: 'f_markup', valueNumber: 50 },
        { entityId: 'cat2', fieldId: 'f_price', valueNumber: 450 },
      ],
    ]

    await syncCatalogItemPricing('org_1', ['part1'])

    expect(h.setValueWithType).toHaveBeenCalledTimes(3) // cat1 cost, cat2 cost, cat2 price
    const calls = h.setValueWithType.mock.calls.map(
      (call) => call[1] as { recordId: string; fieldId: string; value: unknown }
    )

    const cat1Cost = calls.find(
      (c) => c.recordId === 'catalog_item_def:cat1' && c.fieldId === 'f_cost'
    )
    expect(cat1Cost?.value).toEqual({ type: 'number', value: 500 })

    const cat2Cost = calls.find(
      (c) => c.recordId === 'catalog_item_def:cat2' && c.fieldId === 'f_cost'
    )
    expect(cat2Cost?.value).toEqual({ type: 'number', value: 500 })

    const cat2Price = calls.find(
      (c) => c.recordId === 'catalog_item_def:cat2' && c.fieldId === 'f_price'
    )
    expect(cat2Price?.value).toEqual({ type: 'number', value: computeMarkupPrice(500, 50) })

    const cat1Price = calls.find(
      (c) => c.recordId === 'catalog_item_def:cat1' && c.fieldId === 'f_price'
    )
    expect(cat1Price).toBeUndefined()

    expect(h.publishFieldValueUpdates).toHaveBeenCalledTimes(1)
    const entries = h.publishFieldValueUpdates.mock.calls[0]?.[2] as unknown[]
    expect(entries).toHaveLength(3)
  })

  it('skips a write when the new value equals the current value', async () => {
    h.queryQueue = [
      [{ catalogInstanceId: 'cat1', partInstanceId: 'part1' }],
      [{ entityId: 'part1', valueNumber: 500 }],
      [{ entityId: 'cat1', fieldId: 'f_cost', valueNumber: 500 }], // already in sync
    ]
    await syncCatalogItemPricing('org_1', ['part1'])
    expect(h.setValueWithType).not.toHaveBeenCalled()
    expect(h.publishFieldValueUpdates).not.toHaveBeenCalled()
  })

  it('drives off an EntityInstance join that filters archived items in SQL', async () => {
    h.queryQueue = [[]] // joined driving query — an archived item never comes back
    await syncCatalogItemPricing('org_1', ['part1'])

    expect(h.joins).toHaveLength(1)
    const join = h.joins[0]
    expect(join?.table).toBe(schema.EntityInstance)
    expect(clauseContains(join?.where, 'ei.archivedAt')).toBe(true)
    expect(h.setValueWithType).not.toHaveBeenCalled()
  })

  it('skips an explicitly-inactive item but still syncs its active sibling', async () => {
    h.queryQueue = [
      [
        { catalogInstanceId: 'cat1', partInstanceId: 'part1' }, // inactive
        { catalogInstanceId: 'cat2', partInstanceId: 'part1' },
      ],
      [{ entityId: 'part1', valueNumber: 500 }],
      [
        { entityId: 'cat1', fieldId: 'f_cost', valueNumber: 300 },
        { entityId: 'cat1', fieldId: 'f_active', valueBoolean: false },
        { entityId: 'cat2', fieldId: 'f_cost', valueNumber: 300 },
      ],
    ]

    await syncCatalogItemPricing('org_1', ['part1'])

    expect(h.setValueWithType).toHaveBeenCalledTimes(1)
    const write = h.setValueWithType.mock.calls[0]?.[1] as { recordId: string; value: unknown }
    expect(write.recordId).toBe('catalog_item_def:cat2')
    expect(write.value).toEqual({ type: 'number', value: 500 })
  })

  it('syncs an item with NO stored active row (absence means active, never "explicitly true")', async () => {
    h.queryQueue = [
      [{ catalogInstanceId: 'cat1', partInstanceId: 'part1' }],
      [{ entityId: 'part1', valueNumber: 500 }],
      [{ entityId: 'cat1', fieldId: 'f_cost', valueNumber: 300 }], // no f_active row at all
    ]

    await syncCatalogItemPricing('org_1', ['part1'])

    expect(h.setValueWithType).toHaveBeenCalledTimes(1)
    const write = h.setValueWithType.mock.calls[0]?.[1] as { recordId: string; value: unknown }
    expect(write.recordId).toBe('catalog_item_def:cat1')
    expect(write.value).toEqual({ type: 'number', value: 500 })
  })

  it('syncs an item whose active row is explicitly true, same as before', async () => {
    h.queryQueue = [
      [{ catalogInstanceId: 'cat1', partInstanceId: 'part1' }],
      [{ entityId: 'part1', valueNumber: 500 }],
      [
        { entityId: 'cat1', fieldId: 'f_cost', valueNumber: 300 },
        { entityId: 'cat1', fieldId: 'f_active', valueBoolean: true },
      ],
    ]

    await syncCatalogItemPricing('org_1', ['part1'])

    expect(h.setValueWithType).toHaveBeenCalledTimes(1)
    const write = h.setValueWithType.mock.calls[0]?.[1] as { value: unknown }
    expect(write.value).toEqual({ type: 'number', value: 500 })
  })
})

// ─── Interactive triggers (§3) ────────────────────────────────────────

describe('syncCatalogCostOnPartChange', () => {
  it('ignores field changes other than catalog_item_part', async () => {
    const event = buildEvent({
      field: { id: 'f_other', type: 'TEXT', systemAttribute: 'catalog_item_name' },
    })
    await syncCatalogCostOnPartChange(event)
    expect(h.bySystemAttributes).not.toHaveBeenCalled()
  })

  it('archived catalog item: no-op (no reads past the guard, no writes)', async () => {
    h.queryQueue = [
      [{ archivedAt: new Date('2026-08-01') }], // EntityInstance guard: archived
    ]
    const event = buildEvent({
      newValue: [{ type: 'relationship', recordId: 'part:part1' }],
    })
    await syncCatalogCostOnPartChange(event)
    expect(h.setValueWithType).not.toHaveBeenCalled()
    expect(h.queryQueue).toHaveLength(0) // archived check consumed; nothing else queried
  })

  it('explicitly-inactive catalog item: no-op', async () => {
    h.queryQueue = [
      [{ archivedAt: null }], // not archived
      [{ valueBoolean: false }], // catalog_item_active stored false
    ]
    const event = buildEvent({
      newValue: [{ type: 'relationship', recordId: 'part:part1' }],
    })
    await syncCatalogCostOnPartChange(event)
    expect(h.setValueWithType).not.toHaveBeenCalled()
  })

  it('no stored active row: still syncs (absence means active)', async () => {
    h.queryQueue = [
      ...SYNCABLE_GUARD_ROWS, // active row absent — guard passes
      [], // current cost (none yet)
      [{ valueNumber: 500 }], // the linked part's current part_cost
      [], // current markup (none)
    ]
    const event = buildEvent({
      newValue: [{ type: 'relationship', recordId: 'part:part1' }],
    })
    await syncCatalogCostOnPartChange(event)

    expect(h.setValueWithType).toHaveBeenCalledTimes(1)
    const write = h.setValueWithType.mock.calls[0]?.[1] as { fieldId: string; value: unknown }
    expect(write.fieldId).toBe('f_cost')
    expect(write.value).toEqual({ type: 'number', value: 500 })
  })

  it('part set: writes cost, and recomputes price when markup is already set', async () => {
    h.queryQueue = [
      ...SYNCABLE_GUARD_ROWS,
      [], // current cost on the catalog item (none yet)
      [{ valueNumber: 500 }], // the linked part's current part_cost
      [{ valueNumber: 50 }], // current markup on the catalog item
      [{ valueNumber: 200 }], // current (stale) price
    ]
    const event = buildEvent({
      newValue: [{ type: 'relationship', recordId: 'part:part1' }],
    })
    await syncCatalogCostOnPartChange(event)

    expect(h.setValueWithType).toHaveBeenCalledTimes(2)
    const values = h.setValueWithType.mock.calls.map((c) => (c[1] as { value: unknown }).value)
    expect(values).toContainEqual({ type: 'number', value: 500 })
    expect(values).toContainEqual({ type: 'number', value: computeMarkupPrice(500, 50) })
  })

  it('part cleared: clears cost, keeps markup untouched', async () => {
    h.queryQueue = [...SYNCABLE_GUARD_ROWS, [{ valueNumber: 500 }]] // existing cost present
    const event = buildEvent({ newValue: null })
    await syncCatalogCostOnPartChange(event)

    expect(h.setValueWithType).toHaveBeenCalledTimes(1)
    const write = h.setValueWithType.mock.calls[0]?.[1] as { fieldId: string; value: unknown }
    expect(write.fieldId).toBe('f_cost')
    expect(write.value).toBeNull()
  })

  it('part cleared with no existing cost: no-op', async () => {
    h.queryQueue = [...SYNCABLE_GUARD_ROWS, []] // no current cost
    const event = buildEvent({ newValue: null })
    await syncCatalogCostOnPartChange(event)
    expect(h.setValueWithType).not.toHaveBeenCalled()
  })
})

describe('recomputePriceOnMarkupChange', () => {
  it('ignores field changes other than catalog_item_markup', async () => {
    const event = buildEvent({
      field: { id: 'f_other', type: 'TEXT', systemAttribute: 'catalog_item_name' },
    })
    await recomputePriceOnMarkupChange(event)
    expect(h.bySystemAttributes).not.toHaveBeenCalled()
  })

  it('markup cleared: no-op (that IS the pause)', async () => {
    const event = buildEvent({
      field: { id: 'f_markup', type: 'NUMBER', systemAttribute: 'catalog_item_markup' },
      newValue: null,
    })
    await recomputePriceOnMarkupChange(event)
    expect(h.bySystemAttributes).not.toHaveBeenCalled()
    expect(h.setValueWithType).not.toHaveBeenCalled()
  })

  it('markup set but no cost yet: no-op (inert without a linked part)', async () => {
    h.queryQueue = [[]] // no current cost
    const event = buildEvent({
      field: { id: 'f_markup', type: 'NUMBER', systemAttribute: 'catalog_item_markup' },
      newValue: { type: 'number', value: 50 },
    })
    await recomputePriceOnMarkupChange(event)
    expect(h.setValueWithType).not.toHaveBeenCalled()
  })

  it('markup set with a cost basis: recomputes and writes price', async () => {
    h.queryQueue = [
      [{ valueNumber: 500 }], // current cost
      [{ valueNumber: 200 }], // current (stale) price
    ]
    const event = buildEvent({
      field: { id: 'f_markup', type: 'NUMBER', systemAttribute: 'catalog_item_markup' },
      newValue: { type: 'number', value: 50 },
    })
    await recomputePriceOnMarkupChange(event)

    expect(h.setValueWithType).toHaveBeenCalledTimes(1)
    const write = h.setValueWithType.mock.calls[0]?.[1] as { fieldId: string; value: unknown }
    expect(write.fieldId).toBe('f_price')
    expect(write.value).toEqual({ type: 'number', value: computeMarkupPrice(500, 50) })
  })
})

describe('pauseMarkupOnPriceEdit', () => {
  it('ignores field changes other than catalog_item_default_unit_price', async () => {
    const event = buildEvent({
      field: { id: 'f_other', type: 'TEXT', systemAttribute: 'catalog_item_name' },
    })
    await pauseMarkupOnPriceEdit(event)
    expect(h.bySystemAttributes).not.toHaveBeenCalled()
  })

  it('already paused (markup null): no-op', async () => {
    h.queryQueue = [[]] // no current markup
    const event = buildEvent({
      field: {
        id: 'f_price',
        type: 'CURRENCY',
        systemAttribute: 'catalog_item_default_unit_price',
      },
      newValue: { type: 'number', value: 999 },
    })
    await pauseMarkupOnPriceEdit(event)
    expect(h.setValueWithType).not.toHaveBeenCalled()
  })

  it('retyping the exact auto price: no pause', async () => {
    h.queryQueue = [
      [{ valueNumber: 50 }], // current markup
      [{ valueNumber: 500 }], // current cost
    ]
    const event = buildEvent({
      field: {
        id: 'f_price',
        type: 'CURRENCY',
        systemAttribute: 'catalog_item_default_unit_price',
      },
      newValue: { type: 'number', value: computeMarkupPrice(500, 50) },
    })
    await pauseMarkupOnPriceEdit(event)
    expect(h.setValueWithType).not.toHaveBeenCalled()
  })

  it('editing to a different price: pauses by clearing markup', async () => {
    h.queryQueue = [
      [{ valueNumber: 50 }], // current markup
      [{ valueNumber: 500 }], // current cost
    ]
    const event = buildEvent({
      field: {
        id: 'f_price',
        type: 'CURRENCY',
        systemAttribute: 'catalog_item_default_unit_price',
      },
      newValue: { type: 'number', value: 999 },
    })
    await pauseMarkupOnPriceEdit(event)

    expect(h.setValueWithType).toHaveBeenCalledTimes(1)
    const write = h.setValueWithType.mock.calls[0]?.[1] as { fieldId: string; value: unknown }
    expect(write.fieldId).toBe('f_markup')
    expect(write.value).toBeNull()
  })
})
