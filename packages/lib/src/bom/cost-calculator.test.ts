// packages/lib/src/bom/cost-calculator.test.ts
//
// Cover for plans/parts/cost-provenance-and-stale-values.md §1, §5.3-§5.5: `persistCosts`
// used to be write-only, so a part that lost its last vendor part kept the number it had at
// the time; and `part_cost` was one output with two silent meanings, so a NULL there carried
// no information. Harness style follows `money/catalog-pricing.test.ts` and
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
      optionId: 'optionId',
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
  part_purchase_cost: { id: 'f_part_purchase_cost', type: 'CURRENCY' },
  part_rollup_cost: { id: 'f_part_rollup_cost', type: 'CURRENCY' },
  part_cost_source: { id: 'f_part_cost_source', type: 'SINGLE_SELECT' },
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

import {
  calculateAllCosts,
  loadOrgPricingData,
  recalculateAffectedParts,
  recalculateAllPartCosts,
} from './cost-calculator'

const ORG = 'org_1'
const ASSEMBLY = 'part_assembly'
const MOTOR = 'part_motor'
const WIDGET = 'part_widget'

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

interface StoredPart {
  partId: string
  cost?: number
  purchaseCost?: number
  rollupCost?: number
  source?: string
}

/** Existing `part_cost` / `part_purchase_cost` / `part_rollup_cost` / source rows. */
function storedRows(entries: StoredPart[]) {
  const rows: unknown[] = []
  const push = (partId: string, fieldId: string, valueNumber: number | null, optionId?: string) =>
    rows.push({ entityId: partId, fieldId, valueNumber, optionId: optionId ?? null })

  for (const e of entries) {
    if (e.cost != null) push(e.partId, FIELD.part_cost!.id, e.cost)
    if (e.purchaseCost != null) push(e.partId, FIELD.part_purchase_cost!.id, e.purchaseCost)
    if (e.rollupCost != null) push(e.partId, FIELD.part_rollup_cost!.id, e.rollupCost)
    if (e.source != null) push(e.partId, FIELD.part_cost_source!.id, null, e.source)
  }
  return rows
}

/** The three queries `recalculateAffectedParts` runs, in order. */
function queue(vendorParts: unknown[], subparts: unknown[], stored: unknown[]) {
  h.queryQueue = [vendorParts, subparts, stored]
}

/** `recalculateAllPartCosts` inserts a scope query between the graph and the stored values. */
function queueFullSweep(
  vendorParts: unknown[],
  subparts: unknown[],
  partIds: string[],
  stored: unknown[]
) {
  h.queryQueue = [vendorParts, subparts, partIds.map((id) => ({ id })), stored]
}

/** Every `setValueWithType` call for one field, as `{ recordId, value }`. */
function writesFor(fieldId: string) {
  return h.setValueWithType.mock.calls
    .map((call) => call[1] as { recordId: string; fieldId: string; value: unknown })
    .filter((params) => params.fieldId === fieldId)
    .map(({ recordId, value }) => ({ recordId, value }))
}

/** Every field written for one part, keyed by field id. */
function writesForPart(partId: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const call of h.setValueWithType.mock.calls) {
    const params = call[1] as { recordId: string; fieldId: string; value: unknown }
    if (params.recordId !== `part_def:${partId}`) continue
    out[params.fieldId] = params.value
  }
  return out
}

beforeEach(() => {
  vi.clearAllMocks()
  h.queryQueue = []
})

describe('recalculateAffectedParts — clearing values', () => {
  it('clears a stale purchase cost when the part lost its last vendor, and falls back to the BOM cost', async () => {
    // The AL400 case: assembly = 2 x motor @ $180.00, and a $50.00 purchase cost left behind
    // by a vendor part that has since been deleted.
    queue(
      vendorPartRows('vp_motor', MOTOR, 18000),
      subpartRows('sp_1', ASSEMBLY, MOTOR, 2),
      storedRows([{ partId: ASSEMBLY, cost: 5000, purchaseCost: 5000, source: 'vendor' }])
    )

    await recalculateAffectedParts(ORG, [ASSEMBLY])

    expect(writesFor(FIELD.part_cost!.id)).toEqual([
      { recordId: `part_def:${ASSEMBLY}`, value: { type: 'number', value: 36000 } },
    ])
    // The fix: `null` is written as a CLEAR, not skipped as "nothing to do".
    expect(writesFor(FIELD.part_purchase_cost!.id)).toEqual([
      { recordId: `part_def:${ASSEMBLY}`, value: null },
    ])
  })

  it('flips cost source from vendor to bom when the last supplier goes away', async () => {
    queue(
      vendorPartRows('vp_motor', MOTOR, 18000),
      subpartRows('sp_1', ASSEMBLY, MOTOR, 2),
      storedRows([{ partId: ASSEMBLY, cost: 5000, purchaseCost: 5000, source: 'vendor' }])
    )

    await recalculateAffectedParts(ORG, [ASSEMBLY])

    // Provenance is what makes the blank above readable: the number did not just
    // change, it started coming from somewhere else.
    expect(writesFor(FIELD.part_cost_source!.id)).toEqual([
      { recordId: `part_def:${ASSEMBLY}`, value: { type: 'option', optionId: 'bom' } },
    ])
  })

  it('publishes the clear as an explicit null so open clients blank the cell', async () => {
    queue(
      vendorPartRows('vp_motor', MOTOR, 18000),
      subpartRows('sp_1', ASSEMBLY, MOTOR, 2),
      storedRows([{ partId: ASSEMBLY, cost: 5000, purchaseCost: 5000, source: 'vendor' }])
    )

    await recalculateAffectedParts(ORG, [ASSEMBLY])

    const entries = h.publishFieldValueUpdates.mock.calls[0]?.[2] as Array<{
      key: string
      value: unknown
    }>
    // An OMITTED entry means "don't touch the store" (realtime/events.ts), so the cleared
    // cell has to travel as `value: null` or the client keeps rendering the stale number.
    const cleared = entries.find((e) => e.key.includes(FIELD.part_purchase_cost!.id))
    expect(cleared).toBeDefined()
    expect(cleared?.value).toBeNull()
  })

  it('clears the cost of a part that has neither a vendor nor a BOM, and marks it not costed', async () => {
    // Nothing puts this part in the vendor/subpart graph at all — it is only reachable
    // because the caller named it. The dirty set, not the graph, is the persist scope.
    queue([], [], storedRows([{ partId: ASSEMBLY, cost: 5000, source: 'vendor' }]))

    await recalculateAffectedParts(ORG, [ASSEMBLY])

    expect(writesForPart(ASSEMBLY)).toEqual({
      [FIELD.part_cost!.id]: null,
      [FIELD.part_cost_source!.id]: { type: 'option', optionId: 'none' },
    })
  })

  it('writes nothing when the stored values already match', async () => {
    queue(
      vendorPartRows('vp_motor', MOTOR, 18000),
      subpartRows('sp_1', ASSEMBLY, MOTOR, 2),
      storedRows([{ partId: ASSEMBLY, cost: 36000, rollupCost: 36000, source: 'bom' }])
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

describe('recalculateAffectedParts — provenance', () => {
  it('records the roll-up cost even when a supplier price wins', async () => {
    // The assembly can be bought for $100.00 or built from 2 x motor @ $180.00.
    // Storing only the winner is what made buy-vs-build unaskable.
    queue(
      [...vendorPartRows('vp_motor', MOTOR, 18000), ...vendorPartRows('vp_asm', ASSEMBLY, 10000)],
      subpartRows('sp_1', ASSEMBLY, MOTOR, 2),
      []
    )

    await recalculateAffectedParts(ORG, [ASSEMBLY])

    expect(writesForPart(ASSEMBLY)).toEqual({
      [FIELD.part_cost!.id]: { type: 'number', value: 10000 },
      [FIELD.part_purchase_cost!.id]: { type: 'number', value: 10000 },
      [FIELD.part_rollup_cost!.id]: { type: 'number', value: 36000 },
      [FIELD.part_cost_source!.id]: { type: 'option', optionId: 'vendor' },
    })
  })

  it('blanks an assembly with one unpriced component instead of reporting a confident zero', async () => {
    // Before null propagation the widget contributed 0 and the assembly reported a
    // confident $180.00 — a number that silently understated the real cost. An
    // incomplete bill of materials has no cost at all.
    queue(
      vendorPartRows('vp_motor', MOTOR, 18000),
      [...subpartRows('sp_1', ASSEMBLY, MOTOR, 1), ...subpartRows('sp_2', ASSEMBLY, WIDGET, 1)],
      storedRows([{ partId: ASSEMBLY, cost: 18000, rollupCost: 18000, source: 'bom' }])
    )

    await recalculateAffectedParts(ORG, [ASSEMBLY])

    expect(writesForPart(ASSEMBLY)).toEqual({
      [FIELD.part_cost!.id]: null,
      [FIELD.part_rollup_cost!.id]: null,
      [FIELD.part_cost_source!.id]: { type: 'option', optionId: 'none' },
    })
  })

  it('marks an unpriced leaf as not costed rather than free', async () => {
    queue([], subpartRows('sp_1', ASSEMBLY, WIDGET, 3), [])

    await recalculateAffectedParts(ORG, [WIDGET])

    expect(writesForPart(WIDGET)).toEqual({
      [FIELD.part_cost_source!.id]: { type: 'option', optionId: 'none' },
    })
    // No numeric write at all: there was nothing stored and there is nothing to store.
    expect(writesFor(FIELD.part_cost!.id)).toEqual([])
  })
})

describe('recalculateAllPartCosts — scope is every part, not the graph', () => {
  it('clears a frozen value on a part that appears nowhere in the vendor/subpart graph', async () => {
    // This is the case a graph-derived sweep can never reach: no supplier, no BOM,
    // so the part is in neither map — and the stale number survives every recalc.
    queueFullSweep(
      [],
      [],
      [ASSEMBLY],
      storedRows([{ partId: ASSEMBLY, cost: 5000, purchaseCost: 5000, source: 'vendor' }])
    )

    await recalculateAllPartCosts(ORG)

    expect(writesForPart(ASSEMBLY)).toEqual({
      [FIELD.part_cost!.id]: null,
      [FIELD.part_purchase_cost!.id]: null,
      [FIELD.part_cost_source!.id]: { type: 'option', optionId: 'none' },
    })
  })

  it('does not touch parts that are archived out of scope', async () => {
    // MOTOR is priced and would be written by a graph-derived sweep, but it is not
    // in the scope query, so it is not this sweep's business.
    queueFullSweep(
      vendorPartRows('vp_motor', MOTOR, 18000),
      [],
      [ASSEMBLY],
      storedRows([{ partId: MOTOR, cost: 1 }])
    )

    await recalculateAllPartCosts(ORG)

    const touched = h.setValueWithType.mock.calls.map(
      (call) => (call[1] as { recordId: string }).recordId
    )
    expect(touched.every((id) => id === `part_def:${ASSEMBLY}`)).toBe(true)
  })
})

describe('calculateAllCosts — the unpriced-components signal', () => {
  // Tested against `calculateAllCosts` directly: the signal is derived and
  // deliberately never persisted, so there is no FieldValue write to assert on.
  const graph = (edges: Array<[string, string, number]>) => {
    const map = new Map<string, { childId: string; qty: number }[]>()
    for (const [parent, child, qty] of edges) {
      map.set(parent, [...(map.get(parent) ?? []), { childId: child, qty }])
    }
    return map
  }

  it('names the unpriced component that blanked an assembly', () => {
    const results = calculateAllCosts(
      new Map([[MOTOR, 18000]]),
      graph([
        [ASSEMBLY, MOTOR, 1],
        [ASSEMBLY, WIDGET, 1],
      ])
    )

    const assembly = results.get(ASSEMBLY)!
    expect(assembly.cost).toBeNull()
    expect(assembly.source).toBe('none')
    expect(assembly.unpricedDescendantIds).toEqual([WIDGET])
  })

  it('reports nothing for a fully costed assembly', () => {
    const results = calculateAllCosts(new Map([[MOTOR, 18000]]), graph([[ASSEMBLY, MOTOR, 2]]))

    const assembly = results.get(ASSEMBLY)!
    expect(assembly.cost).toBe(36000)
    expect(assembly.unpricedDescendantIds).toEqual([])
  })

  it('attributes the unpriced LEAF, not the intermediate subassembly', () => {
    // top -> sub -> widget(unpriced). `sub` is uncosted too, but adding a
    // supplier to `sub` is not what fixes this — pricing the widget is.
    const TOP = 'part_top'
    const SUB = 'part_sub'
    const results = calculateAllCosts(
      new Map(),
      graph([
        [TOP, SUB, 1],
        [SUB, WIDGET, 4],
      ])
    )

    expect(results.get(TOP)!.unpricedDescendantIds).toEqual([WIDGET])
    expect(results.get(SUB)!.unpricedDescendantIds).toEqual([WIDGET])
    // The leaf itself is the unpriced thing; it is not its own descendant.
    expect(results.get(WIDGET)!.unpricedDescendantIds).toEqual([])
    expect(results.get(WIDGET)!.source).toBe('none')
  })

  it('explains a missing roll-up on a part that IS costed by a vendor', () => {
    // The assembly has a buy price, so `cost` is fine — but the build price is
    // unavailable, and this is the only thing that says why.
    const results = calculateAllCosts(new Map([[ASSEMBLY, 10000]]), graph([[ASSEMBLY, WIDGET, 1]]))

    const assembly = results.get(ASSEMBLY)!
    expect(assembly.cost).toBe(10000)
    expect(assembly.source).toBe('vendor')
    expect(assembly.rollupCost).toBeNull()
    expect(assembly.unpricedDescendantIds).toEqual([WIDGET])
  })

  it('dedupes a leaf reached through two different paths', () => {
    const TOP = 'part_top'
    const LEFT = 'part_left'
    const RIGHT = 'part_right'
    const results = calculateAllCosts(
      new Map(),
      graph([
        [TOP, LEFT, 1],
        [TOP, RIGHT, 1],
        [LEFT, WIDGET, 1],
        [RIGHT, WIDGET, 2],
      ])
    )

    expect(results.get(TOP)!.unpricedDescendantIds).toEqual([WIDGET])
  })

  it('terminates on a cycle instead of walking it forever', () => {
    const A = 'part_a'
    const B = 'part_b'
    const results = calculateAllCosts(
      new Map(),
      graph([
        [A, B, 1],
        [B, A, 1],
      ])
    )

    // The assertion that matters is that this returned at all. A cycle's
    // unpriced leaves are not enumerable, so nothing is claimed.
    expect(results.get(A)!.unpricedDescendantIds).toEqual([])
    expect(results.get(B)!.unpricedDescendantIds).toEqual([])
  })
})

describe('loadOrgPricingData — the offer id the tiebreak depends on', () => {
  it("carries each vendor part's OWN instance id, not just the part it prices", async () => {
    // `selectWinningVendor` breaks an exact tie on `id`. If the loader stopped
    // populating it the comparison would silently be `undefined < undefined`,
    // and the winner would go back to depending on Postgres row order — which
    // is exactly the non-determinism the tiebreak exists to remove. Nothing
    // else in this suite fails if that happens, so it is asserted directly.
    h.queryQueue = [
      [...vendorPartRows('vp_acme', MOTOR, 4000), ...vendorPartRows('vp_bolt', MOTOR, 4000)],
      [],
    ]

    const { vendorPrices } = await loadOrgPricingData(ORG)

    expect(vendorPrices.map((row) => row.id).sort()).toEqual(['vp_acme', 'vp_bolt'])
    // ...and the part id stays a separate field rather than being overwritten.
    expect(new Set(vendorPrices.map((row) => row.partInstanceId))).toEqual(new Set([MOTOR]))
  })
})
