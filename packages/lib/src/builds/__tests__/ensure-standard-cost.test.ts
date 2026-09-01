// packages/lib/src/builds/__tests__/ensure-standard-cost.test.ts
//
// plans/money/tasks/15-costing-usability.md section 1. One rule carries the
// whole safety argument:
//
//   🛑 it writes ONLY parts where `part_standard_cost IS NULL`, and never
//      overwrites.
//
// Overwriting would turn a vendor-price change into an automatic revaluation of
// on-hand inventory. The first two tests here are that rule, from both sides.
//
// Harness style follows `standard-cost.test.ts` next door: mock `@auxx/database`
// so the schema is inert, hand the functions a fake `db` that replays queued
// rows, and assert on the field-value writer's calls.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  queryQueue: [] as unknown[][],
  setValueWithType: vi.fn(async (_ctx: unknown, _params: unknown) => [] as unknown[]),
  publishFieldValueUpdates: vi.fn(async () => {}),
  subparts: [] as { parentPartId: string; childPartId: string; quantity: number }[],
  settings: {} as Record<string, unknown>,
}))

function nextRows(): unknown[] {
  return h.queryQueue.shift() ?? []
}

const db = {
  select: () => ({
    from: () => ({
      where: () => Promise.resolve(nextRows()),
    }),
  }),
} as never

vi.mock('@auxx/database', () => ({
  schema: {
    EntityInstance: {
      id: 'id',
      displayName: 'displayName',
      organizationId: 'organizationId',
      entityDefinitionId: 'entityDefinitionId',
      archivedAt: 'archivedAt',
    },
    FieldValue: {
      entityId: 'entityId',
      fieldId: 'fieldId',
      organizationId: 'organizationId',
      valueNumber: 'valueNumber',
      valueDate: 'valueDate',
      optionId: 'optionId',
    },
  },
}))

const FIELD: Record<string, { id: string; type: string }> = {
  part_kind: { id: 'f_kind', type: 'SINGLE_SELECT' },
  part_cost: { id: 'f_cost', type: 'CURRENCY' },
  part_quantity_on_hand: { id: 'f_qoh', type: 'NUMBER' },
  part_standard_material_cost: { id: 'f_std_mat', type: 'CURRENCY' },
  part_standard_labor_cost: { id: 'f_std_lab', type: 'CURRENCY' },
  part_standard_overhead_cost: { id: 'f_std_ovh', type: 'CURRENCY' },
  part_standard_cost: { id: 'f_std', type: 'CURRENCY' },
  part_standard_cost_effective_at: { id: 'f_std_at', type: 'DATETIME' },
}

const SYSTEM_USER = 'user_system'

vi.mock('../../cache', () => ({
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attrs: readonly string[]) =>
        Object.fromEntries(attrs.map((a) => [a, FIELD[a] ?? null])),
    }),
    get: async (_orgId: string, key: string) => (key === 'systemUser' ? SYSTEM_USER : null),
  }),
  requireCachedEntityDefId: async () => 'part_def',
}))

vi.mock('../../bom/cost-calculator', () => ({
  recalculateAllPartCosts: async () => [],
  loadOrgPricingData: async () => ({ vendorPrices: [], subparts: h.subparts }),
  buildSubpartGraph: (rows: typeof h.subparts) => {
    const map = new Map<string, { childId: string; qty: number }[]>()
    for (const row of rows) {
      const children = map.get(row.parentPartId) ?? []
      children.push({ childId: row.childPartId, qty: row.quantity })
      map.set(row.parentPartId, children)
    }
    return map
  },
  buildParentGraph: (rows: typeof h.subparts) => {
    const map = new Map<string, string[]>()
    for (const row of rows) {
      const parents = map.get(row.childPartId) ?? []
      parents.push(row.parentPartId)
      map.set(row.childPartId, parents)
    }
    return map
  },
}))

vi.mock('../../settings/settings-service', () => ({
  getOrganizationSetting: async ({ key }: { key: string }) => h.settings[key] ?? null,
}))

vi.mock('../../field-values/field-value-helpers', () => ({
  createFieldValueContext: (organizationId: string, userId?: string) => ({
    organizationId,
    userId,
  }),
}))

vi.mock('../../field-values/field-value-mutations', () => ({
  setValueWithType: h.setValueWithType,
}))

vi.mock('../../field-values/stored-field-type', () => ({
  toFieldType: (stored: string) => stored,
}))

vi.mock('../../realtime', () => ({
  getRealtimeService: () => ({}),
  publishFieldValueUpdates: h.publishFieldValueUpdates,
}))

import { ensureStandardCost } from '../ensure-standard-cost'

const ORG = 'org_1'
const MOTOR = 'part_motor'
const TUBE = 'part_tube'
const ASSEMBLY = 'part_assembly'

/** A `FieldValue` row as the loader reads it. */
function fv(
  entityId: string,
  fieldId: string,
  value: { number?: number; date?: string; option?: string }
) {
  return {
    entityId,
    fieldId,
    valueNumber: value.number ?? null,
    valueDate: value.date ?? null,
    optionId: value.option ?? null,
  }
}

/**
 * Queue one org read pass: every part instance, then every stored field value.
 *
 * `ensureStandardCost` makes one pass through `planStandardCostRoll`, and a
 * second one through `loadStandardCostWriteContext` only when the plan aborts.
 */
function queueOrg(
  parts: { id: string; displayName: string | null }[],
  fieldValues: ReturnType<typeof fv>[],
  passes = 1
) {
  h.queryQueue = []
  for (let i = 0; i < passes; i++) h.queryQueue.push(parts, fieldValues)
}

/** Every `setValueWithType` call for one part, flattened to `[fieldId, value]`. */
function writesFor(partId: string) {
  return h.setValueWithType.mock.calls
    .map(([, params]) => params as { recordId: string; fieldId: string; value: unknown })
    .filter((params) => params.recordId.includes(partId))
    .map((params) => [params.fieldId, params.value] as const)
}

const PARTS = [
  { id: MOTOR, displayName: '400Lbs Motor' },
  { id: ASSEMBLY, displayName: '400Lbs motor Assembly' },
  { id: TUBE, displayName: 'Support Tube' },
]

beforeEach(() => {
  vi.clearAllMocks()
  h.setValueWithType.mockImplementation(async () => [])
  h.queryQueue = []
  h.subparts = []
  h.settings = {}
})

describe('ensureStandardCost: the one rule', () => {
  it('never overwrites a part that already has a standard cost', async () => {
    queueOrg(
      [PARTS[0]!],
      [
        fv(MOTOR, FIELD.part_kind!.id, { option: 'component' }),
        // The live cost moved to $22.00...
        fv(MOTOR, FIELD.part_cost!.id, { number: 2200 }),
        // ...and the agreed standard is still $20.10, with stock valued at it.
        fv(MOTOR, FIELD.part_standard_cost!.id, { number: 2010 }),
        fv(MOTOR, FIELD.part_standard_material_cost!.id, { number: 2010 }),
        fv(MOTOR, FIELD.part_quantity_on_hand!.id, { number: 10 }),
      ]
    )

    const result = await ensureStandardCost(db, ORG, [MOTOR], { kind: 'supplier-price' })

    expect(result.isOk()).toBe(true)
    // Writing here would revalue 10 units of on-hand stock because a vendor
    // changed a price. That is the manual roll's decision, never this one's.
    expect(result._unsafeUnwrap().writtenPartIds).toEqual([])
    expect(h.setValueWithType).not.toHaveBeenCalled()
    expect(h.publishFieldValueUpdates).not.toHaveBeenCalled()
  })

  it('never overwrites even when the caller supplies an explicit unit cost', async () => {
    queueOrg(
      [PARTS[0]!],
      [
        fv(MOTOR, FIELD.part_kind!.id, { option: 'component' }),
        fv(MOTOR, FIELD.part_standard_cost!.id, { number: 2010 }),
        fv(MOTOR, FIELD.part_standard_material_cost!.id, { number: 2010 }),
      ]
    )

    // A receipt landing at $12.00 against a standard of $20.10 is a purchase
    // price variance, not a new standard.
    const result = await ensureStandardCost(db, ORG, [MOTOR], { kind: 'receipt', unitCost: 1200 })

    expect(result._unsafeUnwrap().writtenPartIds).toEqual([])
    expect(h.setValueWithType).not.toHaveBeenCalled()
  })
})

describe('ensureStandardCost: writing a first standard', () => {
  it("writes all five fields from the part's live cost", async () => {
    queueOrg(
      [PARTS[0]!],
      [
        fv(MOTOR, FIELD.part_kind!.id, { option: 'component' }),
        fv(MOTOR, FIELD.part_cost!.id, { number: 2200 }),
      ]
    )

    const result = await ensureStandardCost(db, ORG, [MOTOR], { kind: 'supplier-price' })

    expect(result._unsafeUnwrap().writtenPartIds).toEqual([MOTOR])
    const writes = new Map(writesFor(MOTOR))
    expect(writes.get(FIELD.part_standard_material_cost!.id)).toEqual({
      type: 'number',
      value: 2200,
    })
    // A component was not assembled, so its conversion cost is zero as a fact.
    expect(writes.get(FIELD.part_standard_labor_cost!.id)).toEqual({ type: 'number', value: 0 })
    expect(writes.get(FIELD.part_standard_overhead_cost!.id)).toEqual({ type: 'number', value: 0 })
    expect(writes.get(FIELD.part_standard_cost!.id)).toEqual({ type: 'number', value: 2200 })
    expect(writes.get(FIELD.part_standard_cost_effective_at!.id)).toMatchObject({ type: 'date' })
    expect(h.publishFieldValueUpdates).toHaveBeenCalled()
  })

  it('freezes exactly the explicit unit cost, ignoring the live cost', async () => {
    queueOrg(
      [PARTS[0]!],
      [
        fv(MOTOR, FIELD.part_kind!.id, { option: 'component' }),
        // A live replacement cost of $50.00 that has nothing to do with what
        // was actually paid for the stock being opened.
        fv(MOTOR, FIELD.part_cost!.id, { number: 5000 }),
      ]
    )

    const result = await ensureStandardCost(db, ORG, [MOTOR], {
      kind: 'opening-stock',
      unitCost: 1200,
    })

    expect(result._unsafeUnwrap().writtenPartIds).toEqual([MOTOR])
    const writes = new Map(writesFor(MOTOR))
    // The typed number, to the cent. It is being stocked, not built, so there
    // is no conversion cost to absorb.
    expect(writes.get(FIELD.part_standard_cost!.id)).toEqual({ type: 'number', value: 1200 })
    expect(writes.get(FIELD.part_standard_material_cost!.id)).toEqual({
      type: 'number',
      value: 1200,
    })
    expect(writes.get(FIELD.part_standard_labor_cost!.id)).toEqual({ type: 'number', value: 0 })
    expect(writes.get(FIELD.part_standard_overhead_cost!.id)).toEqual({ type: 'number', value: 0 })
  })

  it('widens to an unvalued parent, so pricing a component makes it rollable', async () => {
    h.subparts = [{ parentPartId: ASSEMBLY, childPartId: MOTOR, quantity: 2 }]
    queueOrg(
      [PARTS[0]!, PARTS[1]!],
      [
        fv(MOTOR, FIELD.part_kind!.id, { option: 'component' }),
        fv(MOTOR, FIELD.part_cost!.id, { number: 2200 }),
        fv(ASSEMBLY, FIELD.part_kind!.id, { option: 'subassembly' }),
      ]
    )

    const result = await ensureStandardCost(db, ORG, [MOTOR], { kind: 'supplier-price' })

    // Without the widening the assembly stays "Not rolled" one level up, which
    // is the state 205 of 206 dev-org parts were in.
    expect(result._unsafeUnwrap().writtenPartIds.sort()).toEqual([ASSEMBLY, MOTOR].sort())
    expect(new Map(writesFor(ASSEMBLY)).get(FIELD.part_standard_cost!.id)).toEqual({
      type: 'number',
      value: 4400,
    })
  })

  it('authors the write as the org system user', async () => {
    queueOrg(
      [PARTS[0]!],
      [
        fv(MOTOR, FIELD.part_kind!.id, { option: 'component' }),
        fv(MOTOR, FIELD.part_cost!.id, { number: 2200 }),
      ]
    )

    await ensureStandardCost(db, ORG, [MOTOR], { kind: 'supplier-price' })

    // Nobody pressed a button. Attributing this to whoever edited a price would
    // put a person's name on a decision the system made.
    const ctx = h.setValueWithType.mock.calls[0]?.[0] as { userId?: string }
    expect(ctx.userId).toBe(SYSTEM_USER)
  })
})

describe('ensureStandardCost: the doors it is called from', () => {
  it('skips a part that cannot be valued at all, rather than failing', async () => {
    queueOrg(
      [PARTS[0]!],
      // No `part_cost` and no bill of materials: nothing to freeze.
      [fv(MOTOR, FIELD.part_kind!.id, { option: 'component' })]
    )

    const result = await ensureStandardCost(db, ORG, [MOTOR], { kind: 'supplier-price' })

    // A post-commit hook that throws on a vendor-price save is worse than one
    // that writes nothing.
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().writtenPartIds).toEqual([])
  })

  it('ignores a part id that does not exist', async () => {
    queueOrg([], [])

    const result = await ensureStandardCost(db, ORG, ['part_ghost'], {
      kind: 'opening-stock',
      unitCost: 1200,
    })

    expect(result._unsafeUnwrap().writtenPartIds).toEqual([])
    expect(h.setValueWithType).not.toHaveBeenCalled()
  })

  it('writes the explicit cost even when planning the roll around it aborts', async () => {
    // The motor's parent also contains an unpriced tube, so the roll cannot
    // value the assembly and throws before returning a plan.
    h.subparts = [
      { parentPartId: ASSEMBLY, childPartId: MOTOR, quantity: 1 },
      { parentPartId: ASSEMBLY, childPartId: TUBE, quantity: 4 },
    ]
    queueOrg(
      PARTS,
      [
        fv(MOTOR, FIELD.part_kind!.id, { option: 'component' }),
        fv(ASSEMBLY, FIELD.part_kind!.id, { option: 'subassembly' }),
        fv(TUBE, FIELD.part_kind!.id, { option: 'component' }),
      ],
      // One pass for the plan, one for the fallback context after it aborts.
      2
    )

    const result = await ensureStandardCost(db, ORG, [MOTOR], {
      kind: 'opening-stock',
      unitCost: 1200,
    })

    // Refusing to freeze a number somebody typed because an unrelated sibling
    // has no price would make the create form unusable.
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().writtenPartIds).toEqual([MOTOR])
    expect(new Map(writesFor(MOTOR)).get(FIELD.part_standard_cost!.id)).toEqual({
      type: 'number',
      value: 1200,
    })
    expect(writesFor(ASSEMBLY)).toEqual([])
  })

  // ⤵️ Was 'surfaces the failure when the roll aborts'. The roll no longer aborts
  // on an unvaluable component — it skips it — so this door now returns OK
  // having written nothing, which is what this module's header asked for all
  // along: *"a post-commit hook that throws on a vendor-price save is worse than
  // one that writes nothing"*. The `explicitCost` fallback below still guards
  // the one case that can still throw, a circular bill of materials.
  it('writes nothing, and does not fail, when the roll can value nothing', async () => {
    h.subparts = [
      { parentPartId: ASSEMBLY, childPartId: MOTOR, quantity: 1 },
      { parentPartId: ASSEMBLY, childPartId: TUBE, quantity: 4 },
    ]
    queueOrg(PARTS, [
      fv(MOTOR, FIELD.part_kind!.id, { option: 'component' }),
      fv(ASSEMBLY, FIELD.part_kind!.id, { option: 'subassembly' }),
      fv(TUBE, FIELD.part_kind!.id, { option: 'component' }),
    ])

    const result = await ensureStandardCost(db, ORG, [MOTOR], { kind: 'manual' })

    expect(result._unsafeUnwrap().writtenPartIds).toEqual([])
    expect(h.setValueWithType).not.toHaveBeenCalled()
  })

  it('refuses a zero or negative explicit unit cost', async () => {
    queueOrg([PARTS[0]!], [])

    const result = await ensureStandardCost(db, ORG, [MOTOR], { kind: 'receipt', unitCost: 0 })

    // Every consumer reads a zero standard as "not rolled", so storing one would
    // give the part a standard that nothing recognises.
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toMatch(/positive/i)
    expect(h.setValueWithType).not.toHaveBeenCalled()
  })

  it('does nothing at all for an empty part list', async () => {
    const result = await ensureStandardCost(db, ORG, [], { kind: 'manual' })

    expect(result._unsafeUnwrap().writtenPartIds).toEqual([])
    expect(h.setValueWithType).not.toHaveBeenCalled()
  })
})
