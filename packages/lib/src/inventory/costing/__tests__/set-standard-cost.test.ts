// packages/lib/src/inventory/costing/__tests__/set-standard-cost.test.ts

import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  context: {
    partDefId: 'part_def',
    fields: {} as Record<string, { id: string; type: string } | null>,
    allPartIds: new Set<string>(),
    standardCosts: new Map<string, number>(),
    standardCostSources: new Map<string, string>(),
    quantitiesOnHand: new Map<string, number>(),
    partKinds: new Map<string, string>(),
  },
  movedRows: [] as { partId: string }[],
  ensureStandardCost: vi.fn(),
  replace: vi.fn(),
  roll: vi.fn(),
  edges: [] as { parentPartId: string; childPartId: string; quantity: number }[],
  setValueWithType: vi.fn(async () => []),
  wakePricedParts: vi.fn(async () => ({ isOk: () => true })),
  requestAccountingRecovery: vi.fn(async () => {}),
  requestPartPricing: vi.fn(async () => {}),
}))

vi.mock('@auxx/database', () => ({
  schema: { FieldValue: { relatedEntityId: 'r', organizationId: 'o', fieldId: 'f' } },
}))
vi.mock('../standard-cost-queries', () => ({
  loadStandardCostWriteContext: async () => h.context,
}))
vi.mock('../ensure-standard-cost', () => ({ ensureStandardCost: h.ensureStandardCost }))
vi.mock('../provisional-standard', () => ({ replaceProvisionalStandard: h.replace }))
vi.mock('../roll-unvalued-ancestors', () => ({ rollUnvaluedAncestors: h.roll }))
vi.mock('../cost-calculator', () => ({ loadOrgSubpartEdges: async () => h.edges }))
vi.mock('../../../accounting/work-items/wake', () => ({ wakePricedParts: h.wakePricedParts }))
vi.mock('../../../accounting/work-items/recovery', () => ({
  requestAccountingRecovery: h.requestAccountingRecovery,
  requestPartPricing: h.requestPartPricing,
}))
vi.mock('../../../cache', () => ({
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async () => ({ stock_movement_part: { id: 'f_mv_part' } }),
    }),
    get: async () => 'user_system',
  }),
}))
vi.mock('../../../field-values/field-value-helpers', () => ({
  createFieldValueContext: () => ({}),
}))
vi.mock('../../../field-values/field-value-mutations', () => ({
  setValueWithType: h.setValueWithType,
}))
vi.mock('../../../field-values/stored-field-type', () => ({ toFieldType: (t: string) => t }))
vi.mock('../../../realtime', () => ({
  getRealtimeService: () => ({}),
  publishFieldValueUpdates: async () => {},
}))

import { setStandardCost, setStandardCosts } from '../set-standard-cost'

const db = {
  selectDistinct: () => ({ from: () => ({ where: async () => h.movedRows }) }),
} as never

const ORG = 'org_1'
const FIELDS = {
  material: { id: 'f_mat', type: 'CURRENCY' },
  labor: { id: 'f_lab', type: 'CURRENCY' },
  overhead: { id: 'f_ovh', type: 'CURRENCY' },
  standard: { id: 'f_std', type: 'CURRENCY' },
  effectiveAt: { id: 'f_at', type: 'DATETIME' },
  source: { id: 'f_src', type: 'SINGLE_SELECT' },
  origin: { id: 'f_origin', type: 'SINGLE_SELECT' },
}

function part(
  id: string,
  opts: { standard?: number; source?: string; kind?: string; moved?: boolean } = {}
) {
  h.context.allPartIds.add(id)
  if (opts.standard != null) h.context.standardCosts.set(id, opts.standard)
  if (opts.source) h.context.standardCostSources.set(id, opts.source)
  h.context.partKinds.set(id, opts.kind ?? 'component')
  if (opts.moved) h.movedRows.push({ partId: id })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.context.fields = FIELDS
  h.context.allPartIds = new Set()
  h.context.standardCosts = new Map()
  h.context.standardCostSources = new Map()
  h.context.partKinds = new Map()
  h.movedRows = []
  h.edges = []
  h.replace.mockImplementation(async () =>
    ok({ replaced: true, previousStandard: 5000, newStandard: 4200, revaluationPostedMinor: -1600 })
  )
  h.roll.mockImplementation(async () => ok([]))
  h.ensureStandardCost.mockImplementation(async (_db, _org, partIds: string[]) =>
    ok({ writtenPartIds: partIds })
  )
})

describe('setStandardCost', () => {
  it('sets a first standard through ensureStandardCost as manual, zero included', async () => {
    part('p1')

    const result = await setStandardCost(db, ORG, { partId: 'p1', unitCost: 0 })

    expect(result._unsafeUnwrap()).toEqual({
      action: 'set',
      standardCost: 0,
      revaluationPostedMinor: 0,
    })
    const [, , partIds, source] = h.ensureStandardCost.mock.calls[0]!
    expect(partIds).toEqual(['p1'])
    expect(source.kind).toBe('manual')
    expect(source.unitCosts.get('p1')).toBe(0)
    expect(h.requestAccountingRecovery).toHaveBeenCalledWith(ORG)
  })

  it('restates a provisional standard on a part that has never moved', async () => {
    part('p1', { standard: 5000, source: 'provisional' })

    const result = await setStandardCost(db, ORG, { partId: 'p1', unitCost: 4200 })

    expect(result._unsafeUnwrap()).toEqual({
      action: 'restated',
      standardCost: 4200,
      revaluationPostedMinor: 0,
    })
    expect(h.replace).not.toHaveBeenCalled()
    expect(h.ensureStandardCost).not.toHaveBeenCalled()
    const writes = new Map(
      h.setValueWithType.mock.calls.map((call) => {
        const params = (call as unknown[])[1] as { fieldId: string; value: unknown }
        return [params.fieldId, params.value]
      })
    )
    expect(writes.get('f_std')).toEqual({ type: 'number', value: 4200 })
    expect(writes.get('f_mat')).toEqual({ type: 'number', value: 4200 })
    expect(writes.get('f_origin')).toEqual({ type: 'option', optionId: 'manual' })
    expect(h.wakePricedParts).toHaveBeenCalledWith(db, ORG, { partIds: ['p1'] })
    // 111 Q22: pricing queued after the wake, like the other doors.
    expect(h.requestPartPricing).toHaveBeenCalledWith(ORG, ['p1'])
    expect(h.requestPartPricing.mock.invocationCallOrder[0]!).toBeGreaterThan(
      h.wakePricedParts.mock.invocationCallOrder[0]!
    )
    expect(h.requestAccountingRecovery).toHaveBeenCalledWith(ORG)
  })

  // 09 D-SC2a: a moved part, provisional or confirmed, revalues through the typed door.
  it.each([
    ['a moved provisional', { source: 'provisional', moved: true }],
    ['a confirmed', { source: 'confirmed', moved: true }],
  ])('restates %s standard through the revaluing door', async (_label, opts) => {
    part('p1', { standard: 5000, ...opts })

    const result = await setStandardCost(
      db,
      ORG,
      { partId: 'p1', unitCost: 4200 },
      { userId: 'u1' }
    )

    expect(result._unsafeUnwrap()).toEqual({
      action: 'restated',
      standardCost: 4200,
      revaluationPostedMinor: -1600,
    })
    expect(h.replace).toHaveBeenCalledWith(db, ORG, 'u1', 'p1', 4200, { door: 'typed' })
    expect(h.setValueWithType).not.toHaveBeenCalled()
    expect(h.roll).not.toHaveBeenCalled()
    expect(h.requestAccountingRecovery).toHaveBeenCalledWith(ORG)
  })

  it('fails the entry when the revaluing door fails', async () => {
    part('p1', { standard: 5000, source: 'provisional', moved: true })
    h.replace.mockImplementation(async () => err(new Error('pricing down')))

    const result = await setStandardCost(db, ORG, { partId: 'p1', unitCost: 4200 })

    expect(result._unsafeUnwrapErr().message).toBe('pricing down')
    expect(h.requestAccountingRecovery).not.toHaveBeenCalled()
  })

  it('refuses a service, a negative cost and an unknown part', async () => {
    part('svc', { kind: 'service' })

    expect((await setStandardCost(db, ORG, { partId: 'svc', unitCost: 1 })).isErr()).toBe(true)
    expect((await setStandardCost(db, ORG, { partId: 'svc', unitCost: -1 })).isErr()).toBe(true)
    expect((await setStandardCost(db, ORG, { partId: 'ghost', unitCost: 1 })).isErr()).toBe(true)
    expect(h.ensureStandardCost).not.toHaveBeenCalled()
  })
})

describe('setStandardCosts', () => {
  it('answers every part in input order and fails only the bad rows', async () => {
    part('blank')
    part('prov', { standard: 100, source: 'provisional' })
    part('conf', { standard: 100, source: 'confirmed' })

    const result = await setStandardCosts(db, ORG, [
      { partId: 'conf', unitCost: 1 },
      { partId: 'blank', unitCost: 2 },
      { partId: 'prov', unitCost: 3 },
      { partId: 'blank', unitCost: 9 },
    ])

    const outcomes = result._unsafeUnwrap()
    expect(outcomes.map((o) => [o.partId, o.ok])).toEqual([
      ['conf', true],
      ['blank', true],
      ['prov', true],
    ])
    expect(h.requestAccountingRecovery).toHaveBeenCalledTimes(1)
  })
})

// 09 D-SC3: a part with a BOM rolls from its components unless the person chose "Set cost instead".
describe('a part with a bill of materials', () => {
  beforeEach(() => {
    h.edges = [{ parentPartId: 'fg', childPartId: 'leaf', quantity: 1 }]
  })

  it('refuses a typed cost and names the way out', async () => {
    part('fg', { kind: 'finished_good' })

    const result = await setStandardCost(db, ORG, { partId: 'fg', unitCost: 100 })

    expect(result._unsafeUnwrapErr().message).toMatch(/bill of materials.*Set cost instead/)
    expect(h.ensureStandardCost).not.toHaveBeenCalled()
  })

  it('writes it as manual with the override, through the same doors', async () => {
    part('fg', { kind: 'finished_good' })
    part('fg2', { kind: 'finished_good', standard: 900, source: 'confirmed', moved: true })
    h.edges.push({ parentPartId: 'fg2', childPartId: 'leaf', quantity: 1 })

    const result = await setStandardCosts(db, ORG, [
      { partId: 'fg', unitCost: 100, overrideBom: true },
      { partId: 'fg2', unitCost: 800, overrideBom: true },
    ])

    expect(result._unsafeUnwrap().map((o) => o.ok)).toEqual([true, true])
    expect(h.ensureStandardCost.mock.calls[0]![3].kind).toBe('manual')
    expect(h.replace).toHaveBeenCalledWith(db, ORG, 'user_system', 'fg2', 800, { door: 'typed' })
  })
})

// 09 D-SC7: a first standard rolls the parents it completes, once per save.
describe('rolling the parents of a first standard', () => {
  it('rolls once, with every part that got a first standard', async () => {
    part('a')
    part('b')
    part('c', { standard: 1, source: 'provisional' })

    await setStandardCosts(
      db,
      ORG,
      [
        { partId: 'a', unitCost: 1 },
        { partId: 'b', unitCost: 2 },
        { partId: 'c', unitCost: 3 },
      ],
      { userId: 'u1' }
    )

    expect(h.roll).toHaveBeenCalledTimes(1)
    expect(h.roll).toHaveBeenCalledWith(db, ORG, 'u1', ['a', 'b'])
  })

  it('does not roll when no first standard was written, and a failed roll fails nothing', async () => {
    part('c', { standard: 1, source: 'provisional' })
    await setStandardCost(db, ORG, { partId: 'c', unitCost: 3 })
    expect(h.roll).not.toHaveBeenCalled()

    part('a')
    h.roll.mockImplementation(async () => err(new Error('roll down')))
    const result = await setStandardCost(db, ORG, { partId: 'a', unitCost: 1 })
    expect(result.isOk()).toBe(true)
  })
})
