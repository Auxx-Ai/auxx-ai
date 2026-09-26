// packages/lib/src/inventory/costing/__tests__/ensure-standard-cost.test.ts
//
// The first-standard writer: only the named cost, only where no standard exists (09 D-SC1).

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  wakePricedParts: vi.fn(async () => ({ isOk: () => true })),
  requestPartPricing: vi.fn(async () => {}),
  queryQueue: [] as unknown[][],
  setValueWithType: vi.fn(async (_ctx: unknown, _params: unknown) => [] as unknown[]),
  publishFieldValueUpdates: vi.fn(async () => {}),
}))

vi.mock('../../../accounting/work-items/wake', () => ({ wakePricedParts: h.wakePricedParts }))
// The pricing job is its own subject (`price-parts-job.test.ts`); here only the enqueue matters.
vi.mock('../../../accounting/work-items/recovery', () => ({
  requestPartPricing: h.requestPartPricing,
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
  part_standard_cost_source: { id: 'f_std_src', type: 'SINGLE_SELECT' },
  part_standard_cost_origin: { id: 'f_std_origin', type: 'SINGLE_SELECT' },
}

const SYSTEM_USER = 'user_system'

vi.mock('../../../cache', () => ({
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attrs: readonly string[]) =>
        Object.fromEntries(attrs.map((a) => [a, FIELD[a] ?? null])),
    }),
    get: async (_orgId: string, key: string) => (key === 'systemUser' ? SYSTEM_USER : null),
  }),
  requireCachedEntityDefId: async () => 'part_def',
}))

vi.mock('../../../field-values/field-value-helpers', () => ({
  createFieldValueContext: (organizationId: string, userId?: string) => ({
    organizationId,
    userId,
  }),
}))

vi.mock('../../../field-values/field-value-mutations', () => ({
  setValueWithType: h.setValueWithType,
}))

vi.mock('../../../field-values/stored-field-type', () => ({
  toFieldType: (stored: string) => stored,
}))

vi.mock('../../../realtime', () => ({
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

/** Queue the two reads `loadStandardCostWriteContext` makes: parts, then field values. */
function queueOrg(
  parts: { id: string; displayName: string | null }[],
  values: ReturnType<typeof fv>[]
) {
  h.queryQueue = [parts, values]
}

/** Every `setValueWithType` call for one part, as a map of fieldId to value. */
function writesFor(partId: string) {
  return new Map(
    h.setValueWithType.mock.calls
      .map(([, params]) => params as { recordId: string; fieldId: string; value: unknown })
      .filter((params) => params.recordId.includes(partId))
      .map((params) => [params.fieldId, params.value] as const)
  )
}

const PARTS = [
  { id: MOTOR, displayName: '400Lbs Motor' },
  { id: ASSEMBLY, displayName: '400Lbs motor Assembly' },
  { id: TUBE, displayName: 'Support Tube' },
]

const kind = (id: string, option: string) => fv(id, FIELD.part_kind!.id, { option })

beforeEach(() => {
  vi.clearAllMocks()
  h.setValueWithType.mockImplementation(async () => [])
  h.queryQueue = []
})

describe('ensureStandardCost', () => {
  it('never overwrites a part that already has a standard, even with an explicit cost', async () => {
    queueOrg(
      [PARTS[0]!],
      [kind(MOTOR, 'component'), fv(MOTOR, FIELD.part_standard_cost!.id, { number: 2010 })]
    )

    const result = await ensureStandardCost(db, ORG, [MOTOR], { kind: 'receipt', unitCost: 1200 })

    expect(result._unsafeUnwrap().writtenPartIds).toEqual([])
    expect(h.setValueWithType).not.toHaveBeenCalled()
    expect(h.requestPartPricing).not.toHaveBeenCalled()
  })

  it('freezes exactly the explicit cost as material, ignoring the live cost', async () => {
    queueOrg(
      [PARTS[0]!],
      [kind(MOTOR, 'component'), fv(MOTOR, FIELD.part_cost!.id, { number: 5000 })]
    )

    const result = await ensureStandardCost(db, ORG, [MOTOR], {
      kind: 'opening-stock',
      unitCost: 1200,
    })

    expect(result._unsafeUnwrap().writtenPartIds).toEqual([MOTOR])
    const writes = writesFor(MOTOR)
    expect(writes.get(FIELD.part_standard_cost!.id)).toEqual({ type: 'number', value: 1200 })
    expect(writes.get(FIELD.part_standard_material_cost!.id)).toEqual({
      type: 'number',
      value: 1200,
    })
    expect(writes.get(FIELD.part_standard_labor_cost!.id)).toEqual({ type: 'number', value: 0 })
    expect(writes.get(FIELD.part_standard_overhead_cost!.id)).toEqual({ type: 'number', value: 0 })
    expect(writes.get(FIELD.part_standard_cost_effective_at!.id)).toMatchObject({ type: 'date' })
    expect(writes.get(FIELD.part_standard_cost_origin!.id)).toEqual({
      type: 'option',
      optionId: 'opening_stock',
    })
    expect(h.publishFieldValueUpdates).toHaveBeenCalled()
  })

  it.each([
    ['manual', 'provisional', 'manual'],
    ['receipt', 'confirmed', 'receipt'],
  ] as const)('stamps a %s cost %s, origin %s', async (door, source, origin) => {
    queueOrg([PARTS[0]!], [kind(MOTOR, 'component')])

    await ensureStandardCost(db, ORG, [MOTOR], { kind: door, unitCost: 1234 })

    const writes = writesFor(MOTOR)
    expect(writes.get(FIELD.part_standard_cost_source!.id)).toEqual({
      type: 'option',
      optionId: source,
    })
    expect(writes.get(FIELD.part_standard_cost_origin!.id)).toEqual({
      type: 'option',
      optionId: origin,
    })
  })

  it('queues pricing for the written parts right after the wake, as the system user', async () => {
    queueOrg([PARTS[0]!], [kind(MOTOR, 'component')])

    await ensureStandardCost(db, ORG, [MOTOR], { kind: 'manual', unitCost: 1 })

    expect(h.wakePricedParts).toHaveBeenCalledWith(db, ORG, { partIds: [MOTOR] })
    expect(h.requestPartPricing).toHaveBeenCalledWith(ORG, [MOTOR])
    expect(h.requestPartPricing.mock.invocationCallOrder[0]!).toBeGreaterThan(
      h.wakePricedParts.mock.invocationCallOrder[0]!
    )
    const ctx = h.setValueWithType.mock.calls[0]?.[0] as { userId?: string }
    expect(ctx.userId).toBe(SYSTEM_USER)
  })

  it('infers nothing: no named cost writes nothing, and a parent is never widened in', async () => {
    queueOrg(PARTS, [
      kind(MOTOR, 'component'),
      fv(MOTOR, FIELD.part_cost!.id, { number: 2200 }),
      kind(ASSEMBLY, 'subassembly'),
    ])

    expect(
      (await ensureStandardCost(db, ORG, [MOTOR], { kind: 'manual' }))._unsafeUnwrap()
    ).toEqual({ writtenPartIds: [] })
    expect(h.setValueWithType).not.toHaveBeenCalled()

    queueOrg(PARTS, [kind(MOTOR, 'component'), kind(ASSEMBLY, 'subassembly')])
    const result = await ensureStandardCost(db, ORG, [MOTOR], { kind: 'manual', unitCost: 100 })
    expect(result._unsafeUnwrap().writtenPartIds).toEqual([MOTOR])
    expect(writesFor(ASSEMBLY).size).toBe(0)
  })

  it('skips a service and an unknown id', async () => {
    queueOrg([PARTS[0]!], [kind(MOTOR, 'service')])

    const result = await ensureStandardCost(db, ORG, [MOTOR, 'part_ghost'], {
      kind: 'opening-stock',
      unitCost: 1200,
    })

    expect(result._unsafeUnwrap().writtenPartIds).toEqual([])
    expect(h.setValueWithType).not.toHaveBeenCalled()
  })

  it('accepts zero from a person or a count, refuses it from a receipt, refuses negatives', async () => {
    for (const door of ['manual', 'opening-stock'] as const) {
      vi.clearAllMocks()
      queueOrg([PARTS[0]!], [kind(MOTOR, 'component')])
      const result = await ensureStandardCost(db, ORG, [MOTOR], { kind: door, unitCost: 0 })
      expect(result._unsafeUnwrap().writtenPartIds).toEqual([MOTOR])
    }

    vi.clearAllMocks()
    const receipt = await ensureStandardCost(db, ORG, [MOTOR], { kind: 'receipt', unitCost: 0 })
    expect(receipt._unsafeUnwrapErr().message).toMatch(/positive/i)
    const negative = await ensureStandardCost(db, ORG, [MOTOR], { kind: 'manual', unitCost: -1 })
    expect(negative.isErr()).toBe(true)
    expect(h.setValueWithType).not.toHaveBeenCalled()
  })

  it('freezes a different explicit cost per part from `unitCosts`', async () => {
    queueOrg([PARTS[0]!, PARTS[2]!], [kind(MOTOR, 'component'), kind(TUBE, 'component')])

    const result = await ensureStandardCost(db, ORG, [MOTOR, TUBE], {
      kind: 'manual',
      unitCosts: new Map([
        [MOTOR, 1000],
        [TUBE, 250],
      ]),
    })

    expect(result._unsafeUnwrap().writtenPartIds.sort()).toEqual([MOTOR, TUBE].sort())
    expect(writesFor(MOTOR).get(FIELD.part_standard_cost!.id)).toEqual({
      type: 'number',
      value: 1000,
    })
    expect(writesFor(TUBE).get(FIELD.part_standard_cost!.id)).toEqual({
      type: 'number',
      value: 250,
    })
  })

  it('does nothing at all for an empty part list', async () => {
    const result = await ensureStandardCost(db, ORG, [], { kind: 'manual', unitCost: 1 })

    expect(result._unsafeUnwrap().writtenPartIds).toEqual([])
    expect(h.setValueWithType).not.toHaveBeenCalled()
  })
})
