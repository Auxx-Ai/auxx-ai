// packages/lib/src/inventory/costing/__tests__/set-standard-cost.test.ts

import { ok } from 'neverthrow'
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
  setValueWithType: vi.fn(async () => []),
  wakeReasonCode: vi.fn(async () => ({ isOk: () => true })),
  requestAccountingRecovery: vi.fn(async () => {}),
  pricePending: vi.fn(async () => {}),
}))

vi.mock('@auxx/database', () => ({
  schema: { FieldValue: { relatedEntityId: 'r', organizationId: 'o', fieldId: 'f' } },
}))
vi.mock('../standard-cost-queries', () => ({
  loadStandardCostWriteContext: async () => h.context,
}))
vi.mock('../ensure-standard-cost', () => ({ ensureStandardCost: h.ensureStandardCost }))
vi.mock('../../../accounting/work-items/wake', () => ({ wakeReasonCode: h.wakeReasonCode }))
vi.mock('../price-pending-movements', () => ({ pricePendingMovementsQuietly: h.pricePending }))
vi.mock('../../../accounting/work-items/recovery', () => ({
  requestAccountingRecovery: h.requestAccountingRecovery,
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
  h.ensureStandardCost.mockImplementation(async (_db, _org, partIds: string[]) =>
    ok({ writtenPartIds: partIds })
  )
})

describe('setStandardCost', () => {
  it('sets a first standard through ensureStandardCost as manual, zero included', async () => {
    part('p1')

    const result = await setStandardCost(db, ORG, { partId: 'p1', unitCost: 0 })

    expect(result._unsafeUnwrap()).toEqual({ action: 'set', standardCost: 0 })
    const [, , partIds, source] = h.ensureStandardCost.mock.calls[0]!
    expect(partIds).toEqual(['p1'])
    expect(source.kind).toBe('manual')
    expect(source.unitCosts.get('p1')).toBe(0)
    expect(h.requestAccountingRecovery).toHaveBeenCalledWith(ORG)
  })

  it('restates a provisional standard on a part that has never moved', async () => {
    part('p1', { standard: 5000, source: 'provisional' })

    const result = await setStandardCost(db, ORG, { partId: 'p1', unitCost: 4200 })

    expect(result._unsafeUnwrap()).toEqual({ action: 'restated', standardCost: 4200 })
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
    expect(h.wakeReasonCode).toHaveBeenCalledWith(db, ORG, 'STANDARD_COST_MISSING')
    // 111 Q22: priced inline after the wake (a no-op by construction here - an unmoved part
    // has no rows - but the door prices like the other three).
    expect(h.pricePending).toHaveBeenCalledWith(db, ORG, ['p1'])
    expect(h.pricePending.mock.invocationCallOrder[0]!).toBeGreaterThan(
      h.wakeReasonCode.mock.invocationCallOrder[0]!
    )
    expect(h.requestAccountingRecovery).toHaveBeenCalledWith(ORG)
  })

  it('refuses a confirmed standard and tells the person to roll', async () => {
    part('p1', { standard: 5000, source: 'confirmed' })

    const result = await setStandardCost(db, ORG, { partId: 'p1', unitCost: 4200 })

    expect(result._unsafeUnwrapErr().message).toMatch(/roll/i)
    expect(h.setValueWithType).not.toHaveBeenCalled()
    expect(h.requestAccountingRecovery).not.toHaveBeenCalled()
  })

  it('refuses a provisional standard on a part that has moved', async () => {
    part('p1', { standard: 5000, source: 'provisional', moved: true })

    const result = await setStandardCost(db, ORG, { partId: 'p1', unitCost: 4200 })

    expect(result._unsafeUnwrapErr().message).toMatch(/stock movements.*roll/i)
    expect(h.setValueWithType).not.toHaveBeenCalled()
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
      ['conf', false],
      ['blank', true],
      ['prov', true],
    ])
    expect(h.requestAccountingRecovery).toHaveBeenCalledTimes(1)
  })
})
