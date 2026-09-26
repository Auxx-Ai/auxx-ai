// packages/lib/src/inventory/costing/__tests__/provisional-standard.test.ts
//
// The bootstrap sequence of 73 §6.4, worked:
//
//   create M, type 10             standard 10, provisional
//   opening stock 5 M             Dr Raw 50 / Cr Opening balance 50
//   first PO @ 12, receive 20     standard -> 12, confirmed
//                                 Dr Raw 10 / Cr Inventory revaluation 10
//                                 (no PPV: nothing was known to vary from)
//
// Harness style follows `ensure-standard-cost.test.ts` next door: mock
// `@auxx/database` so the schema is inert, hand the function a fake `db` that
// replays queued rows, and assert on the field-value writer and the
// revaluation writer.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  queryQueue: [] as unknown[][],
  setValueWithType: vi.fn(async (_ctx: unknown, _params: unknown) => [] as unknown[]),
  publishFieldValueUpdates: vi.fn(async () => {}),
  writeRevaluation: vi.fn(async (..._args: unknown[]) => ({
    isErr: () => false,
    value: { movementIds: ['mv_1'], postedMinor: 0 },
  })),
  pricePending: vi.fn(
    async (..._args: unknown[]): Promise<Record<string, unknown>> => ({
      isErr: () => false,
      isOk: () => true,
      value: {},
    })
  ),
}))

function nextRows(): unknown[] {
  return h.queryQueue.shift() ?? []
}

const db = {
  select: () => ({ from: () => ({ where: () => Promise.resolve(nextRows()) }) }),
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
}

vi.mock('../../../cache', () => ({
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attrs: readonly string[]) =>
        Object.fromEntries(attrs.map((a) => [a, FIELD[a] ?? null])),
    }),
    get: async (_orgId: string, key: string) => (key === 'systemUser' ? 'user_system' : null),
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

// The ledger side. Exercised on its own in the builder tests; here what matters
// is WHAT gets handed to it, and when nothing is.
vi.mock('../revalue', () => ({ writeRevaluation: h.writeRevaluation }))
// 111 §1.2: pending rows are priced at the guess BEFORE the delta restates the shelf.
vi.mock('../price-pending-movements', () => ({ pricePendingMovements: h.pricePending }))

import { replaceProvisionalStandard } from '../provisional-standard'

const ORG = 'org_1'
const USER = 'user_1'
const MOTOR = 'part_motor'
const AT = new Date('2026-08-27T00:00:00.000Z')

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

/** The two reads `loadStandardCostWriteContext` makes: parts, then field values. */
function queueOrg(fieldValues: ReturnType<typeof fv>[]) {
  h.queryQueue = [[{ id: MOTOR, displayName: '400Lbs Motor' }], fieldValues]
}

/** A motor typed at $10, five on hand, source as given. */
function motorAt(standard: number, quantityOnHand: number, source: string | null) {
  return [
    fv(MOTOR, FIELD.part_kind!.id, { option: 'component' }),
    fv(MOTOR, FIELD.part_standard_cost!.id, { number: standard }),
    fv(MOTOR, FIELD.part_standard_material_cost!.id, { number: standard }),
    fv(MOTOR, FIELD.part_quantity_on_hand!.id, { number: quantityOnHand }),
    ...(source ? [fv(MOTOR, FIELD.part_standard_cost_source!.id, { option: source })] : []),
  ]
}

function writesFor(partId: string) {
  return h.setValueWithType.mock.calls
    .map(([, params]) => params as { recordId: string; fieldId: string; value: unknown })
    .filter((params) => params.recordId.includes(partId))
    .map((params) => [params.fieldId, params.value] as const)
}

beforeEach(() => {
  vi.clearAllMocks()
  h.setValueWithType.mockImplementation(async () => [])
  h.writeRevaluation.mockImplementation(async () => ({
    isErr: () => false,
    value: { movementIds: ['mv_1'], postedMinor: 1000 },
  }))
  h.queryQueue = []
  h.pricePending.mockImplementation(async () => ({
    isErr: () => false,
    isOk: () => true,
    value: {},
  }))
})

describe('the first receipt of a provisional part', () => {
  it('prices the pending rows at the guess before the standard moves or the shelf is revalued', async () => {
    queueOrg(motorAt(1000, 5, 'provisional'))

    await replaceProvisionalStandard(db, ORG, USER, MOTOR, 1200, { occurredAt: AT })

    expect(h.pricePending).toHaveBeenCalledWith(db, ORG, [MOTOR])
    const priced = h.pricePending.mock.invocationCallOrder[0]!
    expect(priced).toBeLessThan(h.setValueWithType.mock.invocationCallOrder[0]!)
    expect(priced).toBeLessThan(h.writeRevaluation.mock.invocationCallOrder[0]!)
    // The delta still covers the whole shelf: the priced units were valued at the guess.
    expect(h.writeRevaluation.mock.calls[0]![3]).toMatchObject({
      lines: [expect.objectContaining({ extendedDeltaMinor: 1000 })],
    })
  })

  it('does not move the standard when pricing failed, so no unit is revalued unvalued', async () => {
    queueOrg(motorAt(1000, 5, 'provisional'))
    h.pricePending.mockImplementation(async () => ({
      isErr: () => true,
      isOk: () => false,
      error: new Error('pricing down'),
    }))

    const result = await replaceProvisionalStandard(db, ORG, USER, MOTOR, 1200, { occurredAt: AT })

    expect(result.isErr()).toBe(true)
    expect(h.setValueWithType).not.toHaveBeenCalled()
    expect(h.writeRevaluation).not.toHaveBeenCalled()
  })

  it('replaces the standard with the agreed price and confirms it', async () => {
    queueOrg(motorAt(1000, 5, 'provisional'))

    const result = await replaceProvisionalStandard(db, ORG, USER, MOTOR, 1200, { occurredAt: AT })

    expect(result.isOk()).toBe(true)
    const value = result._unsafeUnwrap()
    expect(value.replaced).toBe(true)
    expect(value.previousStandard).toBe(1000)
    expect(value.newStandard).toBe(1200)

    expect(writesFor(MOTOR)).toEqual([
      [FIELD.part_standard_material_cost!.id, { type: 'number', value: 1200 }],
      // Stocked at a vendor's price, not assembled: the whole cost is material.
      [FIELD.part_standard_labor_cost!.id, { type: 'number', value: 0 }],
      [FIELD.part_standard_overhead_cost!.id, { type: 'number', value: 0 }],
      [FIELD.part_standard_cost!.id, { type: 'number', value: 1200 }],
      [
        FIELD.part_standard_cost_effective_at!.id,
        { type: 'date', value: '2026-08-27T00:00:00.000Z' },
      ],
      [FIELD.part_standard_cost_source!.id, { type: 'option', optionId: 'confirmed' }],
    ])
  })

  it('revalues what is already on hand at the guess, through a revalue movement', async () => {
    // §6.4's worked line: 5 on hand, 10 -> 12, so Dr Raw 10 / Cr Inventory
    // revaluation 10. There is NO ppv leg here and there cannot be one — the
    // receipt path emits none for a part this replaced.
    queueOrg(motorAt(1000, 5, 'provisional'))

    await replaceProvisionalStandard(db, ORG, USER, MOTOR, 1200, { occurredAt: AT })

    expect(h.writeRevaluation).toHaveBeenCalledTimes(1)
    const [, , , input] = h.writeRevaluation.mock.calls[0] as [
      unknown,
      string,
      string,
      { lines: unknown[]; occurredAt: Date },
    ]
    expect(input.lines).toEqual([
      {
        partInstanceId: MOTOR,
        unitDeltaMinor: 200,
        extendedDeltaMinor: 1000, // 5 x (1200 - 1000)
        glAccountRole: 'inventory_raw_materials',
      },
    ])
    expect(input.occurredAt).toBe(AT)
  })

  it('posts nothing when the part holds no stock at the guess', async () => {
    queueOrg(motorAt(1000, 0, 'provisional'))

    const result = await replaceProvisionalStandard(db, ORG, USER, MOTOR, 1200, { occurredAt: AT })

    expect(result._unsafeUnwrap().replaced).toBe(true)
    expect(h.writeRevaluation).not.toHaveBeenCalled()
  })

  it('still confirms, and revalues nothing, when the agreed price IS the guess', async () => {
    queueOrg(motorAt(1200, 5, 'provisional'))

    const result = await replaceProvisionalStandard(db, ORG, USER, MOTOR, 1200, { occurredAt: AT })

    expect(result._unsafeUnwrap().replaced).toBe(false)
    expect(writesFor(MOTOR)).toContainEqual([
      FIELD.part_standard_cost_source!.id,
      { type: 'option', optionId: 'confirmed' },
    ])
    expect(h.writeRevaluation).not.toHaveBeenCalled()
  })
})

describe('every other part is left alone', () => {
  it('never touches a confirmed standard', async () => {
    // A second receipt at a different price VARIES against the standard. Moving
    // it would be a moving average wearing a standard's name.
    queueOrg(motorAt(1200, 5, 'confirmed'))

    const result = await replaceProvisionalStandard(db, ORG, USER, MOTOR, 1300, { occurredAt: AT })

    expect(result._unsafeUnwrap().replaced).toBe(false)
    expect(h.setValueWithType).not.toHaveBeenCalled()
    expect(h.writeRevaluation).not.toHaveBeenCalled()
  })

  it('never touches a standard with no stored source', async () => {
    // A NULL source means the standard predates the field. Reading it as
    // provisional would hand the next receipt licence to overwrite a standard
    // somebody agreed to.
    queueOrg(motorAt(1200, 5, null))

    const result = await replaceProvisionalStandard(db, ORG, USER, MOTOR, 1300, { occurredAt: AT })

    expect(result._unsafeUnwrap().replaced).toBe(false)
    expect(h.setValueWithType).not.toHaveBeenCalled()
  })

  it('refuses to replace a standard with a non-positive agreed price', async () => {
    queueOrg(motorAt(1000, 5, 'provisional'))

    const result = await replaceProvisionalStandard(db, ORG, USER, MOTOR, 0, { occurredAt: AT })

    expect(result._unsafeUnwrap().replaced).toBe(false)
    expect(h.setValueWithType).not.toHaveBeenCalled()
  })
})

// 09 D-SC2a: a typed cost on a moved part takes the same sequence, confirmed standards included.
describe('the typed door', () => {
  it('replaces a confirmed standard, stays provisional, and revalues the shelf', async () => {
    queueOrg(motorAt(1200, 5, 'confirmed'))

    const result = await replaceProvisionalStandard(db, ORG, USER, MOTOR, 1000, {
      occurredAt: AT,
      door: 'typed',
    })

    expect(result._unsafeUnwrap()).toMatchObject({
      replaced: true,
      previousStandard: 1200,
      newStandard: 1000,
    })
    expect(h.pricePending.mock.invocationCallOrder[0]!).toBeLessThan(
      h.setValueWithType.mock.invocationCallOrder[0]!
    )
    expect(writesFor(MOTOR)).toContainEqual([
      FIELD.part_standard_cost_source!.id,
      { type: 'option', optionId: 'provisional' },
    ])
    expect(h.writeRevaluation.mock.calls[0]![3]).toMatchObject({
      lines: [expect.objectContaining({ unitDeltaMinor: -200, extendedDeltaMinor: -1000 })],
    })
  })

  it('accepts a typed $0', async () => {
    queueOrg(motorAt(1000, 0, 'provisional'))

    const result = await replaceProvisionalStandard(db, ORG, USER, MOTOR, 0, { door: 'typed' })

    expect(result._unsafeUnwrap()).toMatchObject({ replaced: true, newStandard: 0 })
  })

  it('writes nothing when the typed cost is the standard, so a confirmed one stays confirmed', async () => {
    queueOrg(motorAt(1200, 5, 'confirmed'))

    const result = await replaceProvisionalStandard(db, ORG, USER, MOTOR, 1200, { door: 'typed' })

    expect(result._unsafeUnwrap()).toMatchObject({ replaced: false, revaluationPostedMinor: 0 })
    expect(h.pricePending).not.toHaveBeenCalled()
    expect(h.setValueWithType).not.toHaveBeenCalled()
  })
})
