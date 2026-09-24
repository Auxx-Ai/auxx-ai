// packages/lib/src/accounting/sales/totals/__tests__/part-pricing.test.ts
// Markup pricing on the part (107 D5). `@auxx/database` is mocked with a sequential result
// queue; assertions are on the hook-free writer's calls.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  queryQueue: [] as unknown[][],
  setValueWithType: vi.fn(async (_ctx: unknown, _params: unknown) => [] as unknown[]),
  createFieldValueContext: vi.fn((organizationId: string) => ({ organizationId })),
  getRealtimeService: vi.fn(() => ({})),
  publishFieldValueUpdates: vi.fn(async (_svc: unknown, _orgId: string, _entries: unknown[]) => {}),
  bySystemAttributes: vi.fn(),
  requireCachedEntityDefId: vi.fn(async () => 'part_def'),
}))

function nextRows(): unknown[] {
  return h.queryQueue.shift() ?? []
}

vi.mock('@auxx/database', () => ({
  database: {
    select: () => ({ from: () => ({ where: () => Promise.resolve(nextRows()) }) }),
  },
  schema: {
    FieldValue: {
      entityId: 'entityId',
      fieldId: 'fieldId',
      organizationId: 'organizationId',
      valueNumber: 'valueNumber',
    },
    DataConnectorItem: {
      entityInstanceId: 'dci.entityInstanceId',
      managedFields: 'dci.managedFields',
      pinnedFields: 'dci.pinnedFields',
      organizationId: 'dci.organizationId',
      archivedAt: 'dci.archivedAt',
    },
  },
}))

vi.mock('../../../../cache', () => ({
  getOrgCache: () => ({ from: () => ({ bySystemAttributes: h.bySystemAttributes }) }),
  requireCachedEntityDefId: h.requireCachedEntityDefId,
}))

vi.mock('../../../../field-values/field-value-helpers', () => ({
  createFieldValueContext: h.createFieldValueContext,
}))

vi.mock('../../../../field-values/field-value-mutations', () => ({
  setValueWithType: h.setValueWithType,
}))

vi.mock('../../../../realtime', () => ({
  getRealtimeService: h.getRealtimeService,
  publishFieldValueUpdates: h.publishFieldValueUpdates,
}))

import type { EntityFieldChangeEvent } from '../../../../field-hooks/types'
import {
  computeMarkupPrice,
  pauseMarkupOnPriceEdit,
  recomputePriceOnMarkupChange,
  shouldPauseMarkup,
  syncPartPricing,
} from '../part-pricing'

const PART_FIELDS = {
  part_cost: { id: 'f_cost', type: 'CURRENCY' },
  part_markup: { id: 'f_markup', type: 'NUMBER' },
  part_sell_price: { id: 'f_price', type: 'CURRENCY' },
}

/** FieldValue rows for one part. */
function valueRows(
  partId: string,
  values: { cost?: number; markup?: number; price?: number }
): unknown[] {
  const rows: unknown[] = []
  if (values.cost != null)
    rows.push({ entityId: partId, fieldId: 'f_cost', valueNumber: values.cost })
  if (values.markup != null)
    rows.push({ entityId: partId, fieldId: 'f_markup', valueNumber: values.markup })
  if (values.price != null)
    rows.push({ entityId: partId, fieldId: 'f_price', valueNumber: values.price })
  return rows
}

function writes(): Array<{ recordId: string; fieldId: string; value: unknown }> {
  return h.setValueWithType.mock.calls.map(
    ([, params]) => params as { recordId: string; fieldId: string; value: unknown }
  )
}

function buildEvent(overrides: Record<string, unknown>): EntityFieldChangeEvent {
  return {
    recordId: 'part_def:p1',
    entityDefinitionId: 'part_def',
    entityType: 'part',
    entitySlug: 'parts',
    field: { id: 'f_markup', type: 'NUMBER', systemAttribute: 'part_markup' },
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
  h.bySystemAttributes.mockResolvedValue(PART_FIELDS)
})

describe('computeMarkupPrice', () => {
  it('applies the markup and rounds to whole minor units', () => {
    expect(computeMarkupPrice(320, 50)).toBe(480)
    expect(computeMarkupPrice(1000, 0)).toBe(1000)
    expect(computeMarkupPrice(333, 15)).toBe(383)
  })
})

describe('shouldPauseMarkup', () => {
  it('does not pause on a retype of the auto price', () => {
    expect(shouldPauseMarkup(computeMarkupPrice(500, 50), 500, 50)).toBe(false)
  })

  it('pauses on a different price, a cleared price, or no cost basis', () => {
    expect(shouldPauseMarkup(999, 500, 50)).toBe(true)
    expect(shouldPauseMarkup(null, 500, 50)).toBe(true)
    expect(shouldPauseMarkup(750, null, 50)).toBe(true)
  })
})

describe('syncPartPricing', () => {
  it('is a no-op for an empty change set', async () => {
    const result = await syncPartPricing('org_1', [])
    expect(result._unsafeUnwrap()).toBe(0)
    expect(h.bySystemAttributes).not.toHaveBeenCalled()
  })

  it('skips an org without the selling fields', async () => {
    h.bySystemAttributes.mockResolvedValue({ part_cost: PART_FIELDS.part_cost })
    const result = await syncPartPricing('org_1', ['p1'])
    expect(result._unsafeUnwrap()).toBe(0)
    expect(h.setValueWithType).not.toHaveBeenCalled()
  })

  it('recomputes the price on the same part when a markup is set', async () => {
    h.queryQueue = [
      [
        ...valueRows('p1', { cost: 500, markup: 50, price: 700 }),
        ...valueRows('p2', { cost: 400 }),
      ],
      [], // no connector bindings
    ]
    const result = await syncPartPricing('org_1', ['p1', 'p2'])

    expect(result._unsafeUnwrap()).toBe(1)
    expect(writes()).toEqual([
      {
        recordId: 'part_def:p1',
        fieldId: 'f_price',
        fieldType: 'CURRENCY',
        value: { type: 'number', value: 750 },
      },
    ])
    expect(h.publishFieldValueUpdates).toHaveBeenCalledOnce()
  })

  it('writes nothing when the price already matches', async () => {
    h.queryQueue = [valueRows('p1', { cost: 500, markup: 50, price: 750 })]
    const result = await syncPartPricing('org_1', ['p1'])
    expect(result._unsafeUnwrap()).toBe(0)
    expect(h.setValueWithType).not.toHaveBeenCalled()
  })

  it('leaves price and markup alone when the cost is gone', async () => {
    h.queryQueue = [valueRows('p1', { markup: 50, price: 750 })]
    await syncPartPricing('org_1', ['p1'])
    expect(h.setValueWithType).not.toHaveBeenCalled()
  })

  it('skips a part whose price a connector writes', async () => {
    h.queryQueue = [
      valueRows('p1', { cost: 500, markup: 50, price: 700 }),
      [{ entityInstanceId: 'p1', managedFields: ['part_def:f_price'], pinnedFields: [] }],
    ]
    const result = await syncPartPricing('org_1', ['p1'])
    expect(result._unsafeUnwrap()).toBe(0)
    expect(h.setValueWithType).not.toHaveBeenCalled()
  })

  it('still prices a bound part whose connector does not write the price, or is paused on it', async () => {
    h.queryQueue = [
      [
        ...valueRows('p1', { cost: 500, markup: 50 }),
        ...valueRows('p2', { cost: 200, markup: 100 }),
      ],
      [
        { entityInstanceId: 'p1', managedFields: ['part_def:f_title'], pinnedFields: [] },
        { entityInstanceId: 'p2', managedFields: ['part_def:f_price'], pinnedFields: ['f_price'] },
      ],
    ]
    const result = await syncPartPricing('org_1', ['p1', 'p2'])
    expect(result._unsafeUnwrap()).toBe(2)
  })

  it('returns an error instead of throwing', async () => {
    h.bySystemAttributes.mockRejectedValue(new Error('cache down'))
    const result = await syncPartPricing('org_1', ['p1'])
    expect(result.isErr()).toBe(true)
  })
})

describe('recomputePriceOnMarkupChange', () => {
  it('ignores other fields', async () => {
    await recomputePriceOnMarkupChange(
      buildEvent({ field: { id: 'f_price', type: 'CURRENCY', systemAttribute: 'part_sell_price' } })
    )
    expect(h.bySystemAttributes).not.toHaveBeenCalled()
  })

  it('does nothing when the markup is cleared (that is the pause)', async () => {
    await recomputePriceOnMarkupChange(buildEvent({ newValue: null }))
    expect(h.setValueWithType).not.toHaveBeenCalled()
  })

  it('does nothing without a cost', async () => {
    h.queryQueue = [valueRows('p1', { price: 900 })]
    await recomputePriceOnMarkupChange(buildEvent({ newValue: { type: 'number', value: 50 } }))
    expect(h.setValueWithType).not.toHaveBeenCalled()
  })

  it('writes the auto price from the current cost', async () => {
    h.queryQueue = [valueRows('p1', { cost: 500, price: 900 }), []]
    await recomputePriceOnMarkupChange(buildEvent({ newValue: { type: 'number', value: 50 } }))
    expect(writes()).toEqual([
      {
        recordId: 'part_def:p1',
        fieldId: 'f_price',
        fieldType: 'CURRENCY',
        value: { type: 'number', value: 750 },
      },
    ])
  })

  it('does not price a connector-priced part', async () => {
    h.queryQueue = [
      valueRows('p1', { cost: 500 }),
      [{ entityInstanceId: 'p1', managedFields: ['f_price'], pinnedFields: [] }],
    ]
    await recomputePriceOnMarkupChange(buildEvent({ newValue: { type: 'number', value: 50 } }))
    expect(h.setValueWithType).not.toHaveBeenCalled()
  })
})

describe('pauseMarkupOnPriceEdit', () => {
  const priceField = { id: 'f_price', type: 'CURRENCY', systemAttribute: 'part_sell_price' }

  it('does nothing when no markup is set', async () => {
    h.queryQueue = [valueRows('p1', { cost: 500, price: 999 })]
    await pauseMarkupOnPriceEdit(
      buildEvent({ field: priceField, newValue: { type: 'number', value: 999 } })
    )
    expect(h.setValueWithType).not.toHaveBeenCalled()
  })

  it('keeps the markup on a retype of the auto price', async () => {
    h.queryQueue = [valueRows('p1', { cost: 500, markup: 50, price: 750 })]
    await pauseMarkupOnPriceEdit(
      buildEvent({ field: priceField, newValue: { type: 'number', value: 750 } })
    )
    expect(h.setValueWithType).not.toHaveBeenCalled()
  })

  it('clears the markup on a hand-typed price', async () => {
    h.queryQueue = [valueRows('p1', { cost: 500, markup: 50, price: 999 })]
    await pauseMarkupOnPriceEdit(
      buildEvent({ field: priceField, newValue: { type: 'number', value: 999 } })
    )
    expect(writes()).toEqual([
      { recordId: 'part_def:p1', fieldId: 'f_markup', fieldType: 'NUMBER', value: null },
    ])
  })
})
