// packages/lib/src/builds/__tests__/standard-cost.test.ts
//
// The IO half of the roll: ancestor widening against real data, the revaluation
// delta the preview exists to show, and what actually gets written.
// Harness style follows `bom/cost-calculator.test.ts` — mock `@auxx/database`'s
// schema, hand the functions a fake `db`, and assert on the writer's calls.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  queryQueue: [] as unknown[][],
  setValueWithType: vi.fn(async (_ctx: unknown, _params: unknown) => [] as unknown[]),
  publishFieldValueUpdates: vi.fn(async () => {}),
  recalculateAllPartCosts: vi.fn(async (_orgId: string) => [] as string[]),
  subparts: [] as { parentPartId: string; childPartId: string; quantity: number }[],
  settings: {} as Record<string, unknown>,
  callOrder: [] as string[],
}))

function nextRows(): unknown[] {
  return h.queryQueue.shift() ?? []
}

/** Minimal drizzle-shaped stub: `select().from().where()` resolves the next queued rows. */
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

vi.mock('../../cache', () => ({
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attrs: readonly string[]) =>
        Object.fromEntries(attrs.map((a) => [a, FIELD[a] ?? null])),
    }),
  }),
  requireCachedEntityDefId: async () => 'part_def',
}))

vi.mock('../../bom/cost-calculator', () => ({
  recalculateAllPartCosts: async (orgId: string) => {
    h.callOrder.push('recalculateAllPartCosts')
    return h.recalculateAllPartCosts(orgId)
  },
  loadOrgPricingData: async () => {
    h.callOrder.push('loadOrgPricingData')
    return { vendorPrices: [], subparts: h.subparts }
  },
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

import { rollStandardCost } from '../standard-cost'
import { previewStandardCostRoll, readStandardCost } from '../standard-cost-queries'

const ORG = 'org_1'
const USER = 'user_1'
const MOTOR = 'part_motor'
const ASSEMBLY = 'part_assembly'
const LIFT = 'part_lift'
const EFFECTIVE_AT = new Date('2026-08-27T00:00:00.000Z')

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
 * Queue the two reads `planStandardCostRoll` makes, in the order it makes them:
 * every part instance, then every stored field value.
 */
function queueOrg(
  parts: { id: string; displayName: string | null }[],
  fieldValues: ReturnType<typeof fv>[]
) {
  h.queryQueue = [parts, fieldValues]
}

/** The lift graph: motor -> assembly -> lift, one of each. */
function liftSubparts() {
  return [
    { parentPartId: ASSEMBLY, childPartId: MOTOR, quantity: 1 },
    { parentPartId: LIFT, childPartId: ASSEMBLY, quantity: 2 },
  ]
}

const PARTS = [
  { id: MOTOR, displayName: '400Lbs Motor' },
  { id: ASSEMBLY, displayName: '400Lbs motor Assembly' },
  { id: LIFT, displayName: 'Auxx Lift 400lbs 4x8' },
]

beforeEach(() => {
  vi.clearAllMocks()
  // `clearAllMocks` clears calls but keeps implementations, so a test that made
  // a write fail would leak that failure into every test after it.
  h.setValueWithType.mockImplementation(async () => [])
  h.queryQueue = []
  h.subparts = []
  h.settings = {}
  h.callOrder = []
})

describe('previewStandardCostRoll', () => {
  it('reports the revaluation delta per part and summed, without writing', async () => {
    h.subparts = liftSubparts()
    queueOrg(PARTS, [
      fv(MOTOR, FIELD.part_kind!.id, { option: 'component' }),
      fv(MOTOR, FIELD.part_cost!.id, { number: 2200 }),
      fv(MOTOR, FIELD.part_quantity_on_hand!.id, { number: 10 }),
      // Previously rolled at $20.10; the new standard is $22.00.
      fv(MOTOR, FIELD.part_standard_cost!.id, { number: 2010 }),
      fv(MOTOR, FIELD.part_standard_material_cost!.id, { number: 2010 }),
      fv(MOTOR, FIELD.part_standard_cost_effective_at!.id, { date: '2026-01-01T00:00:00.000Z' }),
    ])

    const result = await previewStandardCostRoll(db, ORG, {
      partIds: [MOTOR],
      effectiveAt: EFFECTIVE_AT,
    })

    expect(result.isOk()).toBe(true)
    const plan = result._unsafeUnwrap()
    const motor = plan.lines.find((line) => line.partId === MOTOR)!
    expect(motor.previousStandardCost).toBe(2010)
    expect(motor.standardCost).toBe(2200)
    expect(motor.quantityOnHand).toBe(10)
    expect(motor.revaluationDelta).toBe(1900) // (2200 - 2010) x 10
    expect(motor.isInitial).toBe(false)
    expect(plan.revaluationDelta).toBe(1900)

    // A preview restates nothing. Nothing is written and `part_cost` is not
    // even refreshed, so a `.query()` procedure can call it.
    expect(h.setValueWithType).not.toHaveBeenCalled()
    expect(h.callOrder).not.toContain('recalculateAllPartCosts')
  })

  it('reports a first roll as an initial valuation, not as a revaluation', async () => {
    queueOrg(
      [PARTS[0]!],
      [
        fv(MOTOR, FIELD.part_kind!.id, { option: 'component' }),
        fv(MOTOR, FIELD.part_cost!.id, { number: 2200 }),
        fv(MOTOR, FIELD.part_quantity_on_hand!.id, { number: 10 }),
      ]
    )

    const plan = (
      await previewStandardCostRoll(db, ORG, { partIds: [MOTOR], effectiveAt: EFFECTIVE_AT })
    )._unsafeUnwrap()

    const motor = plan.lines[0]!
    expect(motor.isInitial).toBe(true)
    // Folding this into the delta would report the whole on-hand inventory value
    // as a variance on the very first roll.
    expect(motor.revaluationDelta).toBe(0)
    expect(motor.initialValue).toBe(22000)
    expect(plan.revaluationDelta).toBe(0)
    expect(plan.initialValue).toBe(22000)
  })

  it('widens a scoped roll to every ancestor of the parts named', async () => {
    h.subparts = liftSubparts()
    queueOrg(PARTS, [
      fv(MOTOR, FIELD.part_kind!.id, { option: 'component' }),
      fv(MOTOR, FIELD.part_cost!.id, { number: 2010 }),
      fv(ASSEMBLY, FIELD.part_kind!.id, { option: 'subassembly' }),
      fv(LIFT, FIELD.part_kind!.id, { option: 'finished_good' }),
    ])
    h.settings = {
      'manufacturing.assemblyLaborCostPerUnit': 500,
      'manufacturing.overheadCostPerUnit': 200,
    }

    // Only the motor is named — the assembly and the lift are carrying standards
    // built from the old number and must be rolled with it.
    const plan = (
      await previewStandardCostRoll(db, ORG, { partIds: [MOTOR], effectiveAt: EFFECTIVE_AT })
    )._unsafeUnwrap()

    expect(plan.lines.map((line) => line.partId)).toEqual([MOTOR, ASSEMBLY, LIFT])
    expect(plan.lines.find((l) => l.partId === ASSEMBLY)!.standardCost).toBe(2710)
    expect(plan.lines.find((l) => l.partId === LIFT)!.standardCost).toBe(6120)
  })

  // ⤵️ Was 'surfaces an unpriced component as UnprocessableEntityError'. The
  // preview no longer fails the whole run for one unpriced part — it reports it
  // and values everything else. The information is not lost, it moved from an
  // error message into `skipped`, where a list can render every offender rather
  // than only the first one the walk happened to reach.
  it('reports an unpriced component in `skipped` instead of failing the preview', async () => {
    h.subparts = liftSubparts()
    queueOrg(PARTS, [
      fv(ASSEMBLY, FIELD.part_kind!.id, { option: 'subassembly' }),
      fv(LIFT, FIELD.part_kind!.id, { option: 'finished_good' }),
    ])

    const result = await previewStandardCostRoll(db, ORG, { effectiveAt: EFFECTIVE_AT })

    const plan = result._unsafeUnwrap()
    expect(plan.skipped.some((s) => s.partName === '400Lbs Motor')).toBe(true)
    // The parent gave up too, and it names the motor rather than itself.
    expect(
      plan.skipped.some(
        (s) => s.reason === 'component-not-valuable' && s.blockedByPartName === '400Lbs Motor'
      )
    ).toBe(true)
  })

  it('refuses when the part_standard_* fields have not been provisioned', async () => {
    const saved = FIELD.part_standard_cost!
    delete FIELD.part_standard_cost
    try {
      const result = await previewStandardCostRoll(db, ORG, { effectiveAt: EFFECTIVE_AT })
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().message).toMatch(/not available/i)
    } finally {
      FIELD.part_standard_cost = saved
    }
  })
})

describe('rollStandardCost', () => {
  /** Every `setValueWithType` call, flattened to `fieldId -> value`. */
  function writesFor(partId: string) {
    return h.setValueWithType.mock.calls
      .map(([, params]) => params as { recordId: string; fieldId: string; value: unknown })
      .filter((params) => params.recordId.includes(partId))
      .map((params) => [params.fieldId, params.value] as const)
  }

  it('refreshes part_cost before planning, so the roll never freezes a stale price', async () => {
    queueOrg(
      [PARTS[0]!],
      [
        fv(MOTOR, FIELD.part_kind!.id, { option: 'component' }),
        fv(MOTOR, FIELD.part_cost!.id, { number: 2200 }),
      ]
    )

    await rollStandardCost(db, ORG, USER, { partIds: [MOTOR], effectiveAt: EFFECTIVE_AT })

    expect(h.callOrder[0]).toBe('recalculateAllPartCosts')
    expect(h.callOrder).toContain('loadOrgPricingData')
  })

  it('writes all five fields and stamps the effective date', async () => {
    queueOrg(
      [PARTS[0]!],
      [
        fv(MOTOR, FIELD.part_kind!.id, { option: 'component' }),
        fv(MOTOR, FIELD.part_cost!.id, { number: 2200 }),
        fv(MOTOR, FIELD.part_quantity_on_hand!.id, { number: 4 }),
      ]
    )

    const result = await rollStandardCost(db, ORG, USER, {
      partIds: [MOTOR],
      effectiveAt: EFFECTIVE_AT,
    })

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().writtenPartIds).toEqual([MOTOR])
    expect(writesFor(MOTOR)).toEqual([
      [FIELD.part_standard_material_cost!.id, { type: 'number', value: 2200 }],
      // A component's conversion cost is zero as a FACT, not as an absence.
      [FIELD.part_standard_labor_cost!.id, { type: 'number', value: 0 }],
      [FIELD.part_standard_overhead_cost!.id, { type: 'number', value: 0 }],
      [FIELD.part_standard_cost!.id, { type: 'number', value: 2200 }],
      [
        FIELD.part_standard_cost_effective_at!.id,
        { type: 'date', value: '2026-08-27T00:00:00.000Z' },
      ],
    ])
  })

  it('clears the absorption components when no rate is declared, rather than leaving a stale one', async () => {
    h.subparts = [{ parentPartId: ASSEMBLY, childPartId: MOTOR, quantity: 1 }]
    queueOrg(
      [PARTS[0]!, PARTS[1]!],
      [
        fv(MOTOR, FIELD.part_kind!.id, { option: 'component' }),
        fv(MOTOR, FIELD.part_cost!.id, { number: 2200 }),
        fv(ASSEMBLY, FIELD.part_kind!.id, { option: 'subassembly' }),
        // A rate that WAS declared when this part was last rolled.
        fv(ASSEMBLY, FIELD.part_standard_labor_cost!.id, { number: 500 }),
      ]
    )
    // ...and is not declared now.
    h.settings = {}

    await rollStandardCost(db, ORG, USER, { effectiveAt: EFFECTIVE_AT })

    const writes = new Map(writesFor(ASSEMBLY))
    expect(writes.get(FIELD.part_standard_labor_cost!.id)).toBeNull()
    expect(writes.get(FIELD.part_standard_overhead_cost!.id)).toBeNull()
    expect(writes.get(FIELD.part_standard_cost!.id)).toEqual({ type: 'number', value: 2200 })
  })

  it('writes nothing, and does not move the effective date, when the standard has not changed', async () => {
    queueOrg(
      [PARTS[0]!],
      [
        fv(MOTOR, FIELD.part_kind!.id, { option: 'component' }),
        fv(MOTOR, FIELD.part_cost!.id, { number: 2200 }),
        fv(MOTOR, FIELD.part_standard_material_cost!.id, { number: 2200 }),
        fv(MOTOR, FIELD.part_standard_labor_cost!.id, { number: 0 }),
        fv(MOTOR, FIELD.part_standard_overhead_cost!.id, { number: 0 }),
        fv(MOTOR, FIELD.part_standard_cost!.id, { number: 2200 }),
        fv(MOTOR, FIELD.part_standard_cost_effective_at!.id, { date: '2026-01-01T00:00:00.000Z' }),
      ]
    )

    const result = await rollStandardCost(db, ORG, USER, { effectiveAt: EFFECTIVE_AT })

    // A standard that did not move took effect earlier. Restamping it would
    // erase the one signal that says how stale it is.
    expect(result._unsafeUnwrap().writtenPartIds).toEqual([])
    expect(h.setValueWithType).not.toHaveBeenCalled()
    expect(h.publishFieldValueUpdates).not.toHaveBeenCalled()
  })

  it('touches only the five part_standard_* fields — never a stock movement', async () => {
    h.subparts = liftSubparts()
    queueOrg(PARTS, [
      fv(MOTOR, FIELD.part_kind!.id, { option: 'component' }),
      fv(MOTOR, FIELD.part_cost!.id, { number: 2010 }),
      fv(ASSEMBLY, FIELD.part_kind!.id, { option: 'subassembly' }),
      fv(LIFT, FIELD.part_kind!.id, { option: 'finished_good' }),
    ])

    await rollStandardCost(db, ORG, USER, { effectiveAt: EFFECTIVE_AT })

    const owned = new Set([
      FIELD.part_standard_material_cost!.id,
      FIELD.part_standard_labor_cost!.id,
      FIELD.part_standard_overhead_cost!.id,
      FIELD.part_standard_cost!.id,
      FIELD.part_standard_cost_effective_at!.id,
    ])
    const touched = h.setValueWithType.mock.calls.map(
      ([, params]) => (params as { fieldId: string }).fieldId
    )
    expect(touched.length).toBeGreaterThan(0)
    // A mid-period standard change is a one-time revaluation of ON-HAND stock,
    // never a restatement of history.
    expect(touched.every((fieldId) => owned.has(fieldId))).toBe(true)
  })

  it('aborts the roll when a write fails, rather than reporting a partial success', async () => {
    h.subparts = liftSubparts()
    queueOrg(PARTS, [
      fv(MOTOR, FIELD.part_kind!.id, { option: 'component' }),
      fv(MOTOR, FIELD.part_cost!.id, { number: 2010 }),
      fv(ASSEMBLY, FIELD.part_kind!.id, { option: 'subassembly' }),
      fv(LIFT, FIELD.part_kind!.id, { option: 'finished_good' }),
    ])
    // The last part in the bottom-up order fails; the two beneath it land.
    h.setValueWithType.mockImplementation(async (_ctx, params) => {
      const { recordId } = params as { recordId: string }
      if (recordId.includes(LIFT)) throw new Error('connection lost')
      return []
    })

    const result = await rollStandardCost(db, ORG, USER, { effectiveAt: EFFECTIVE_AT })

    // A half-applied roll reported as a success would leave a parent frozen
    // against children that never moved.
    expect(result.isErr()).toBe(true)
    // What did land is still published, so open clients are not left rendering a
    // stale number that no reload explains.
    expect(h.publishFieldValueUpdates).toHaveBeenCalled()
  })

  it('returns the revaluation delta rather than posting it', async () => {
    queueOrg(
      [PARTS[0]!],
      [
        fv(MOTOR, FIELD.part_kind!.id, { option: 'component' }),
        fv(MOTOR, FIELD.part_cost!.id, { number: 2200 }),
        fv(MOTOR, FIELD.part_quantity_on_hand!.id, { number: 10 }),
        fv(MOTOR, FIELD.part_standard_cost!.id, { number: 2010 }),
        fv(MOTOR, FIELD.part_standard_cost_effective_at!.id, { date: '2026-01-01T00:00:00.000Z' }),
      ]
    )

    const result = await rollStandardCost(db, ORG, USER, { effectiveAt: EFFECTIVE_AT })

    // GL posting is out of scope for this directory (README B9) — the number is
    // computed and handed back, and nothing writes a journal entry.
    expect(result._unsafeUnwrap().revaluationDelta).toBe(1900)
  })
})

describe('readStandardCost', () => {
  it('omits a part that has never been rolled, so absence can never read as zero', async () => {
    h.queryQueue = [
      [
        fv(MOTOR, FIELD.part_standard_cost!.id, { number: 2200 }),
        fv(MOTOR, FIELD.part_standard_material_cost!.id, { number: 2200 }),
        fv(MOTOR, FIELD.part_standard_cost_effective_at!.id, { date: '2026-08-27T00:00:00.000Z' }),
        // The assembly has a material component but no standard — a half-written
        // row is still not a standard.
        fv(ASSEMBLY, FIELD.part_standard_material_cost!.id, { number: 5000 }),
      ],
    ]

    const result = await readStandardCost(db, ORG, [MOTOR, ASSEMBLY, LIFT])

    const map = result._unsafeUnwrap()
    expect(map.get(MOTOR)).toEqual({
      partId: MOTOR,
      standardMaterialCost: 2200,
      standardLaborCost: null,
      standardOverheadCost: null,
      standardCost: 2200,
      effectiveAt: new Date('2026-08-27T00:00:00.000Z'),
    })
    expect(map.has(ASSEMBLY)).toBe(false)
    expect(map.has(LIFT)).toBe(false)
  })

  // 🛑 The invariant is POSITIVE, not non-null. `assertPlanIsPostable` documents
  // this function as the reason it can exist ("a missing standard is a refusal,
  // never a zero"), and its error says "Refusing to complete a build at zero
  // cost" — but while a stored `0` stayed in the map, that check could not fire
  // for the case it is named after, and `unitCost: 0` froze onto an append-only
  // movement. A zero only ever arrives from a part that could not be valued.
  it('omits a part rolled to ZERO, exactly like one never rolled at all', async () => {
    h.queryQueue = [
      [
        fv(MOTOR, FIELD.part_standard_cost!.id, { number: 0 }),
        fv(MOTOR, FIELD.part_standard_material_cost!.id, { number: 0 }),
        fv(ASSEMBLY, FIELD.part_standard_cost!.id, { number: 2200 }),
        fv(ASSEMBLY, FIELD.part_standard_material_cost!.id, { number: 2200 }),
      ],
    ]

    const result = await readStandardCost(db, ORG, [MOTOR, ASSEMBLY])

    const map = result._unsafeUnwrap()
    expect(map.has(MOTOR)).toBe(false)
    expect(map.get(ASSEMBLY)?.standardCost).toBe(2200)
  })

  it('keeps a part standing at one minor unit, so the rule is > 0 and not a threshold', async () => {
    h.queryQueue = [
      [
        fv(MOTOR, FIELD.part_standard_cost!.id, { number: 1 }),
        fv(MOTOR, FIELD.part_standard_material_cost!.id, { number: 1 }),
      ],
    ]

    const result = await readStandardCost(db, ORG, [MOTOR])

    expect(result._unsafeUnwrap().get(MOTOR)?.standardCost).toBe(1)
  })

  it('short-circuits on an empty part list without querying', async () => {
    const result = await readStandardCost(db, ORG, [])
    expect(result._unsafeUnwrap().size).toBe(0)
  })
})

// ─── task 15 section 3: the roll used to throw on every built part ─────────
//
// `RollStandardCostPopover` sends `partIds: [thisPart]`. The scope widened to
// ancestors ONLY, so a child was never in scope, `contributionOf` read its
// stored (null) standard, and the walk aborted on every built part in a fresh
// org. The fix widens DOWN as well, to the descendants with nothing to
// re-value.
describe('planStandardCostRoll descendant widening', () => {
  it('pulls in a descendant that has no stored standard, and values it first', async () => {
    h.subparts = liftSubparts()
    queueOrg(PARTS, [
      fv(MOTOR, FIELD.part_kind!.id, { option: 'component' }),
      fv(MOTOR, FIELD.part_cost!.id, { number: 2010 }),
      fv(ASSEMBLY, FIELD.part_kind!.id, { option: 'subassembly' }),
      fv(LIFT, FIELD.part_kind!.id, { option: 'finished_good' }),
    ])

    // Rolling the finished good from its own drawer, exactly as the popover does.
    const result = await previewStandardCostRoll(db, ORG, {
      partIds: [LIFT],
      effectiveAt: EFFECTIVE_AT,
    })

    expect(result.isOk()).toBe(true)
    const plan = result._unsafeUnwrap()
    const valued = new Map(plan.lines.map((line) => [line.partId, line]))
    // Bottom-up, so the component is valued before the assembly built from it.
    expect(plan.lines.map((line) => line.partId)).toEqual([MOTOR, ASSEMBLY, LIFT])
    expect(valued.get(MOTOR)!.standardCost).toBe(2010)
    expect(valued.get(ASSEMBLY)!.standardCost).toBe(2010)
    expect(valued.get(LIFT)!.standardCost).toBe(4020)
    // Every one of them is a FIRST valuation, which is what makes pulling them
    // in safe: there is nothing to re-value.
    expect(plan.lines.every((line) => line.isInitial)).toBe(true)
    expect(plan.revaluationDelta).toBe(0)
  })

  it('leaves a descendant that already has a standard alone, and takes its stored value', async () => {
    h.subparts = liftSubparts()
    queueOrg(PARTS, [
      fv(MOTOR, FIELD.part_kind!.id, { option: 'component' }),
      fv(MOTOR, FIELD.part_cost!.id, { number: 2010 }),
      fv(ASSEMBLY, FIELD.part_kind!.id, { option: 'subassembly' }),
      // An agreed standard. Re-valuing it is what the caller did NOT ask for.
      fv(ASSEMBLY, FIELD.part_standard_cost!.id, { number: 9999 }),
      fv(ASSEMBLY, FIELD.part_standard_material_cost!.id, { number: 9999 }),
      fv(ASSEMBLY, FIELD.part_standard_cost_effective_at!.id, { date: '2026-01-01T00:00:00.000Z' }),
      fv(LIFT, FIELD.part_kind!.id, { option: 'finished_good' }),
    ])

    const plan = (
      await previewStandardCostRoll(db, ORG, { partIds: [LIFT], effectiveAt: EFFECTIVE_AT })
    )._unsafeUnwrap()

    const partIds = plan.lines.map((line) => line.partId)
    expect(partIds).not.toContain(ASSEMBLY)
    // 2 x the assembly's STORED standard, not a freshly rolled one. This is what
    // keeps `completeBuild` balanced: the consume rows are valued at the same
    // number the parent was built from.
    expect(plan.lines.find((line) => line.partId === LIFT)!.standardCost).toBe(19998)
  })

  it('names the real remedy when a component genuinely cannot be valued', async () => {
    h.subparts = liftSubparts()
    queueOrg(PARTS, [
      // No `part_cost` at all, so the motor is skipped and the assembly above it
      // has no number to build from.
      fv(MOTOR, FIELD.part_kind!.id, { option: 'component' }),
      fv(ASSEMBLY, FIELD.part_kind!.id, { option: 'subassembly' }),
      fv(LIFT, FIELD.part_kind!.id, { option: 'finished_good' }),
    ])

    const result = await previewStandardCostRoll(db, ORG, {
      partIds: [LIFT],
      effectiveAt: EFFECTIVE_AT,
    })

    // ⤵️ Was an `isErr` assertion on the message. The remedy is still the point,
    // it is just carried structurally now: `blockedByPartName` names the part to
    // go price, and the two screens render it through `skipReasonLabel`.
    // "Give it a price or roll it first" was wrong: it is a lie when the
    // component already HAS a price and simply has no priced bill of materials.
    const plan = result._unsafeUnwrap()
    const lift = plan.skipped.find((s) => s.partId === LIFT)
    expect(lift?.reason).toBe('component-not-valuable')
    // NOT the assembly in between, which nobody can price.
    expect(lift?.blockedByPartName).toBe('400Lbs Motor')
  })
})
