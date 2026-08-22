// packages/lib/src/bom/cost-calculator.test.ts
//
// Regression cover for plans/parts/cost-provenance-and-stale-values.md §1: `persistCosts`
// used to be write-only, so a part that lost its last vendor part kept the number it had at
// the time. Harness style follows `money/catalog-pricing.test.ts` and
// `field-hooks/post/bom-cost-triggers.test.ts` — mock `@auxx/database` with a sequential
// result queue and assert on the writer's calls rather than on drizzle column identity.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  queryQueue: [] as unknown[][],
  setValueWithType: vi.fn(async (_ctx: unknown, _params: unknown) => [] as unknown[]),
  createFieldValueContext: vi.fn((organizationId: string) => ({ organizationId })),
  getRealtimeService: vi.fn(() => ({})),
  publishFieldValueUpdates: vi.fn(async (_svc: unknown, _orgId: string, _entries: unknown[]) => {}),
  syncCatalogItemPricing: vi.fn(async () => {}),
}))

function nextRows(): unknown[] {
  return h.queryQueue.shift() ?? []
}

vi.mock('@auxx/database', () => ({
  database: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({ where: () => Promise.resolve(nextRows()) }),
        where: () => Promise.resolve(nextRows()),
      }),
    }),
  },
  schema: {
    EntityInstance: {
      id: 'id',
      organizationId: 'organizationId',
      entityDefinitionId: 'entityDefinitionId',
      archivedAt: 'archivedAt',
    },
    FieldValue: {
      entityId: 'entityId',
      fieldId: 'fieldId',
      organizationId: 'organizationId',
      valueNumber: 'valueNumber',
      valueBoolean: 'valueBoolean',
      relatedEntityId: 'relatedEntityId',
    },
  },
}))

// Field ids the cache hands back, keyed by systemAttribute.
const FIELD: Record<string, { id: string; type: string }> = {
  vendor_part_part: { id: 'f_vp_part', type: 'RELATIONSHIP' },
  vendor_part_unit_price: { id: 'f_vp_price', type: 'CURRENCY' },
  vendor_part_is_preferred: { id: 'f_vp_pref', type: 'CHECKBOX' },
  vendor_part_shipping_cost: { id: 'f_vp_ship', type: 'CURRENCY' },
  vendor_part_tariff_rate: { id: 'f_vp_tariff', type: 'NUMBER' },
  vendor_part_other_cost: { id: 'f_vp_other', type: 'CURRENCY' },
  subpart_parent_part: { id: 'f_sp_parent', type: 'RELATIONSHIP' },
  subpart_child_part: { id: 'f_sp_child', type: 'RELATIONSHIP' },
  subpart_quantity: { id: 'f_sp_qty', type: 'NUMBER' },
  part_cost: { id: 'f_part_cost', type: 'CURRENCY' },
  part_unit_price: { id: 'f_part_unit_price', type: 'CURRENCY' },
}

vi.mock('../cache', () => ({
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attrs: readonly string[]) =>
        Object.fromEntries(attrs.map((a) => [a, FIELD[a] ?? null])),
      bySystemAttribute: async (attr: string) => FIELD[attr] ?? null,
    }),
  }),
  requireCachedEntityDefId: async (_orgId: string, entityType: string) => `${entityType}_def`,
}))

vi.mock('../field-values/field-value-helpers', () => ({
  createFieldValueContext: h.createFieldValueContext,
}))

vi.mock('../field-values/field-value-mutations', () => ({
  setValueWithType: h.setValueWithType,
}))

vi.mock('../field-values/stored-field-type', () => ({
  toFieldType: (stored: string) => stored,
}))

vi.mock('../realtime', () => ({
  getRealtimeService: h.getRealtimeService,
  publishFieldValueUpdates: h.publishFieldValueUpdates,
}))

vi.mock('../money/catalog-pricing', () => ({
  syncCatalogItemPricing: h.syncCatalogItemPricing,
}))

import { recalculateAffectedParts } from './cost-calculator'

const ORG = 'org_1'
const ASSEMBLY = 'part_assembly'
const MOTOR = 'part_motor'

/** A `vendor_part` instance priced at `unitPrice`, linked to `partId`. */
function vendorPartRows(instanceId: string, partId: string, unitPrice: number) {
  return [
    {
      instanceId,
      fieldId: FIELD.vendor_part_part!.id,
      valueNumber: null,
      valueBoolean: null,
      relatedEntityId: partId,
    },
    {
      instanceId,
      fieldId: FIELD.vendor_part_unit_price!.id,
      valueNumber: unitPrice,
      valueBoolean: null,
      relatedEntityId: null,
    },
  ]
}

/** A `subpart` instance: `qty` of `childId` inside `parentId`. */
function subpartRows(instanceId: string, parentId: string, childId: string, qty: number) {
  return [
    {
      instanceId,
      fieldId: FIELD.subpart_parent_part!.id,
      valueNumber: null,
      relatedEntityId: parentId,
    },
    {
      instanceId,
      fieldId: FIELD.subpart_child_part!.id,
      valueNumber: null,
      relatedEntityId: childId,
    },
    { instanceId, fieldId: FIELD.subpart_quantity!.id, valueNumber: qty, relatedEntityId: null },
  ]
}

/** Existing `part_cost` / `part_unit_price` FieldValue rows. */
function storedRows(entries: Array<{ partId: string; cost?: number; unitPrice?: number }>) {
  const rows: unknown[] = []
  for (const e of entries) {
    if (e.cost != null)
      rows.push({ entityId: e.partId, fieldId: FIELD.part_cost!.id, valueNumber: e.cost })
    if (e.unitPrice != null)
      rows.push({
        entityId: e.partId,
        fieldId: FIELD.part_unit_price!.id,
        valueNumber: e.unitPrice,
      })
  }
  return rows
}

/** The three queries `recalculateAffectedParts` runs, in order. */
function queue(vendorParts: unknown[], subparts: unknown[], stored: unknown[]) {
  h.queryQueue = [vendorParts, subparts, stored]
}

/** Every `setValueWithType` call for one field, as `{ recordId, value }`. */
function writesFor(fieldId: string) {
  return h.setValueWithType.mock.calls
    .map((call) => call[1] as { recordId: string; fieldId: string; value: unknown })
    .filter((params) => params.fieldId === fieldId)
    .map(({ recordId, value }) => ({ recordId, value }))
}

beforeEach(() => {
  vi.clearAllMocks()
  h.queryQueue = []
})

describe('recalculateAffectedParts — clearing values', () => {
  it('clears a stale unit price when the part lost its last vendor, and falls back to the BOM cost', async () => {
    // The AL400 case: assembly = 2 × motor @ $180.00, and a $50.00 unit price left behind by
    // a vendor part that has since been deleted.
    queue(
      vendorPartRows('vp_motor', MOTOR, 18000),
      subpartRows('sp_1', ASSEMBLY, MOTOR, 2),
      storedRows([{ partId: ASSEMBLY, cost: 5000, unitPrice: 5000 }])
    )

    await recalculateAffectedParts(ORG, [ASSEMBLY])

    expect(writesFor(FIELD.part_cost!.id)).toEqual([
      { recordId: `part_def:${ASSEMBLY}`, value: { type: 'number', value: 36000 } },
    ])
    // The fix: `null` is written as a CLEAR, not skipped as "nothing to do".
    expect(writesFor(FIELD.part_unit_price!.id)).toEqual([
      { recordId: `part_def:${ASSEMBLY}`, value: null },
    ])
  })

  it('publishes the clear as an explicit null so open clients blank the cell', async () => {
    queue(
      vendorPartRows('vp_motor', MOTOR, 18000),
      subpartRows('sp_1', ASSEMBLY, MOTOR, 2),
      storedRows([{ partId: ASSEMBLY, cost: 5000, unitPrice: 5000 }])
    )

    await recalculateAffectedParts(ORG, [ASSEMBLY])

    const entries = h.publishFieldValueUpdates.mock.calls[0]?.[2] as Array<{
      key: string
      value: unknown
    }>
    // An OMITTED entry means "don't touch the store" (realtime/events.ts), so the cleared
    // cell has to travel as `value: null` or the client keeps rendering the stale number.
    const cleared = entries.find((e) => e.key.includes(FIELD.part_unit_price!.id))
    expect(cleared).toBeDefined()
    expect(cleared?.value).toBeNull()
  })

  it('clears the cost of a part that has neither a vendor nor a BOM', async () => {
    // Nothing puts this part in the vendor/subpart graph at all — it is only reachable
    // because the caller named it. The dirty set, not the graph, is the persist scope.
    queue([], [], storedRows([{ partId: ASSEMBLY, cost: 5000 }]))

    await recalculateAffectedParts(ORG, [ASSEMBLY])

    expect(writesFor(FIELD.part_cost!.id)).toEqual([
      { recordId: `part_def:${ASSEMBLY}`, value: null },
    ])
  })

  it('writes nothing when the stored values already match', async () => {
    queue(
      vendorPartRows('vp_motor', MOTOR, 18000),
      subpartRows('sp_1', ASSEMBLY, MOTOR, 2),
      storedRows([{ partId: ASSEMBLY, cost: 36000 }])
    )

    await recalculateAffectedParts(ORG, [ASSEMBLY])

    expect(h.setValueWithType).not.toHaveBeenCalled()
    expect(h.publishFieldValueUpdates).not.toHaveBeenCalled()
  })

  it('leaves parts outside the dirty set alone', async () => {
    // The motor is a CHILD of the assembly, not an ancestor, so recalculating the assembly
    // must not rewrite it — even though its cost is computed along the way.
    queue(
      vendorPartRows('vp_motor', MOTOR, 18000),
      subpartRows('sp_1', ASSEMBLY, MOTOR, 2),
      storedRows([
        { partId: ASSEMBLY, cost: 5000 },
        { partId: MOTOR, cost: 1 },
      ])
    )

    await recalculateAffectedParts(ORG, [ASSEMBLY])

    const touched = h.setValueWithType.mock.calls.map(
      (call) => (call[1] as { recordId: string }).recordId
    )
    expect(new Set(touched)).toEqual(new Set([`part_def:${ASSEMBLY}`]))
  })
})
