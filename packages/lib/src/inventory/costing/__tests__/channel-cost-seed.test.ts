// packages/lib/src/inventory/costing/__tests__/channel-cost-seed.test.ts

import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  rows: [] as {
    entityId: string
    fieldId: string
    valueNumber: number | null
    optionId: string | null
  }[],
  ensureStandardCost: vi.fn(),
  requestAccountingRecovery: vi.fn(async () => {}),
  pricePending: vi.fn(async () => {}),
}))

vi.mock('@auxx/database', () => ({
  database: {},
  schema: {
    FieldValue: {
      entityId: 'e',
      fieldId: 'f',
      valueNumber: 'n',
      optionId: 'o',
      organizationId: 'org',
    },
  },
}))
vi.mock('../ensure-standard-cost', () => ({ ensureStandardCost: h.ensureStandardCost }))
vi.mock('../price-pending-movements', () => ({ pricePendingMovementsQuietly: h.pricePending }))
vi.mock('../../../accounting/work-items/recovery', () => ({
  requestAccountingRecovery: h.requestAccountingRecovery,
}))
vi.mock('../../../cache', () => ({
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async () => ({
        part_channel_cost: { id: 'f_channel' },
        part_standard_cost: { id: 'f_std' },
        part_kind: { id: 'f_kind' },
      }),
    }),
  }),
}))

import { seedStandardOnChannelCostBatch } from '../../../field-hooks/post/channel-cost-seed'
import { seedStandardFromChannelCost } from '../channel-cost-seed'

const db = { select: () => ({ from: () => ({ where: async () => h.rows }) }) } as never
const ORG = 'org_1'

function row(entityId: string, fieldId: string, value: { n?: number; o?: string }) {
  return { entityId, fieldId, valueNumber: value.n ?? null, optionId: value.o ?? null }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.rows = []
  h.ensureStandardCost.mockImplementation(async (_db, _org, partIds: string[]) =>
    ok({ writtenPartIds: partIds })
  )
})

describe('seedStandardFromChannelCost (106 D5)', () => {
  it('seeds a channel standard on a part with a channel cost and no standard', async () => {
    h.rows = [row('p1', 'f_channel', { n: 34696 }), row('p1', 'f_kind', { o: 'finished_good' })]

    const result = await seedStandardFromChannelCost(db, ORG, ['p1'])

    expect(result._unsafeUnwrap().writtenPartIds).toEqual(['p1'])
    const [, , partIds, source] = h.ensureStandardCost.mock.calls[0]!
    expect(partIds).toEqual(['p1'])
    expect(source.kind).toBe('channel')
    expect(source.unitCosts.get('p1')).toBe(34696)
    // 111 Q22: the seeded parts' pending rows are priced inline, before the recovery request.
    expect(h.pricePending).toHaveBeenCalledWith(db, ORG, ['p1'])
    expect(h.requestAccountingRecovery).toHaveBeenCalledWith(ORG)
    expect(h.pricePending.mock.invocationCallOrder[0]!).toBeLessThan(
      h.requestAccountingRecovery.mock.invocationCallOrder[0]!
    )
  })

  it('leaves a part that already has a standard, and a service', async () => {
    h.rows = [
      row('priced', 'f_channel', { n: 100 }),
      row('priced', 'f_std', { n: 90 }),
      row('svc', 'f_channel', { n: 100 }),
      row('svc', 'f_kind', { o: 'service' }),
      row('nocost', 'f_kind', { o: 'component' }),
    ]

    const result = await seedStandardFromChannelCost(db, ORG, ['priced', 'svc', 'nocost'])

    expect(result._unsafeUnwrap().writtenPartIds).toEqual([])
    expect(h.ensureStandardCost).not.toHaveBeenCalled()
    expect(h.requestAccountingRecovery).not.toHaveBeenCalled()
    expect(h.pricePending).not.toHaveBeenCalled()
  })
})

describe('the sync-lane hook', () => {
  const target = (partId: string, systemAttribute: string) =>
    ({
      recordId: `part_def:${partId}`,
      field: { systemAttribute },
    }) as never

  it('seeds only the parts whose channel cost was touched', async () => {
    h.rows = [row('p1', 'f_channel', { n: 500 })]

    await seedStandardOnChannelCostBatch({
      organizationId: ORG,
      userId: 'system',
      db,
      targets: [target('p1', 'part_channel_cost'), target('p2', 'part_sell_price')],
    })

    expect(h.ensureStandardCost).toHaveBeenCalledTimes(1)
    expect(h.ensureStandardCost.mock.calls[0]![2]).toEqual(['p1'])
  })

  it('never throws on a failure, so the sync goes on', async () => {
    h.rows = [row('p1', 'f_channel', { n: 500 })]
    h.ensureStandardCost.mockRejectedValueOnce(new Error('boom'))

    await expect(
      seedStandardOnChannelCostBatch({
        organizationId: ORG,
        userId: 'system',
        db,
        targets: [target('p1', 'part_channel_cost')],
      })
    ).resolves.toBeUndefined()
  })
})
