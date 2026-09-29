// packages/lib/src/inventory/costing/__tests__/confirm-standard-cost.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  context: {
    partDefId: 'part_def',
    fields: {} as Record<string, { id: string; type: string } | null>,
    standardCosts: new Map<string, number>(),
    partKinds: new Map<string, string>(),
  },
  setValueWithType: vi.fn(async () => []),
}))

vi.mock('../standard-cost-queries', () => ({
  loadStandardCostWriteContext: async () => h.context,
}))
vi.mock('../../../cache', () => ({ getOrgCache: () => ({ get: async () => 'user_system' }) }))
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

import { confirmStandardCosts } from '../confirm-standard-cost'

const FIELDS = {
  source: { id: 'f_src', type: 'SINGLE_SELECT' },
  origin: { id: 'f_origin', type: 'SINGLE_SELECT' },
}

type Write = { fieldId: string; value: { optionId: string } }
const writes = () =>
  (h.setValueWithType.mock.calls as unknown as [unknown, Write][]).map(([, w]) => w)

beforeEach(() => {
  vi.clearAllMocks()
  h.context.fields = FIELDS
  h.context.standardCosts = new Map([
    ['a', 100],
    ['b', 200],
    ['svc', 50],
  ])
  h.context.partKinds = new Map([
    ['a', 'component'],
    ['b', 'component'],
    ['svc', 'service'],
  ])
})

describe('confirmStandardCosts (plans/mrp/22 §3.3)', () => {
  it('marks existing standards confirmed and restamps an origin only when asked', async () => {
    const result = await confirmStandardCosts({} as never, 'org_1', [
      { partId: 'a' },
      { partId: 'b', origin: 'supplier_price' },
    ])
    expect(result._unsafeUnwrap()).toEqual(['a', 'b'])
    expect(writes().map((w) => [w.fieldId, w.value.optionId])).toEqual([
      ['f_src', 'confirmed'],
      ['f_src', 'confirmed'],
      ['f_origin', 'supplier_price'],
    ])
  })

  it('skips a part with no standard, a service and a repeat, and never writes the amount', async () => {
    const result = await confirmStandardCosts({} as never, 'org_1', [
      { partId: 'none' },
      { partId: 'svc' },
      { partId: 'a' },
      { partId: 'a' },
    ])
    expect(result._unsafeUnwrap()).toEqual(['a'])
    expect(writes().every((w) => w.fieldId === 'f_src' || w.fieldId === 'f_origin')).toBe(true)
  })

  it('writes nothing on an org without the source field', async () => {
    h.context.fields = { source: null, origin: null }
    const result = await confirmStandardCosts({} as never, 'org_1', [{ partId: 'a' }])
    expect(result._unsafeUnwrap()).toEqual([])
    expect(h.setValueWithType).not.toHaveBeenCalled()
  })
})
