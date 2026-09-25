// packages/lib/src/field-hooks/post/__tests__/inventory-triggers.test.ts
// QoH has one owner (111 Q26): the per-movement hook hands the part to `batchRecalculateQoH`.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  batchRecalculateQoH: vi.fn(async () => {}),
  partRows: [] as Array<{ relatedEntityId: string | null }>,
}))

vi.mock('@auxx/database', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  database: {
    select: () => {
      const link: Record<string, unknown> = {}
      link.from = () => link
      link.innerJoin = () => link
      link.where = () => link
      link.limit = async () => h.partRows
      return link
    },
  },
}))
vi.mock('../../../cache', () => ({
  getOrgCache: () => ({}),
  requireCachedEntityDefId: async () => 'def_part',
}))
vi.mock('../../../realtime', () => ({
  getRealtimeService: () => ({}),
  publishFieldValueUpdates: async () => {},
}))
vi.mock('../../../inventory/costing/qoh', () => ({
  batchRecalculateQoH: h.batchRecalculateQoH,
}))

import { recalculatePartQoH } from '../inventory-triggers'

const event = (values: Record<string, unknown>) =>
  ({
    organizationId: 'org_1',
    entityInstanceId: 'mv_1',
    action: 'created',
    values,
  }) as never

beforeEach(() => {
  vi.clearAllMocks()
  h.partRows = []
})

describe('recalculatePartQoH', () => {
  it('delegates to batchRecalculateQoH for the movement’s part and sums nothing itself', async () => {
    await recalculatePartQoH(event({ stock_movement_part: { recordId: 'def_part:part_1' } }))
    expect(h.batchRecalculateQoH).toHaveBeenCalledWith('org_1', ['part_1'])
  })

  it('resolves the part from the stored value when the event is thin', async () => {
    h.partRows = [{ relatedEntityId: 'part_9' }]
    await recalculatePartQoH(event({}))
    expect(h.batchRecalculateQoH).toHaveBeenCalledWith('org_1', ['part_9'])
  })

  it('does nothing for a BOM-explosion parent: the explode trigger owns those parts', async () => {
    await recalculatePartQoH(
      event({
        stock_movement_adjust_subparts: true,
        stock_movement_part: { recordId: 'def_part:part_1' },
      })
    )
    expect(h.batchRecalculateQoH).not.toHaveBeenCalled()
  })

  it('warns out rather than summing when no part can be resolved', async () => {
    await recalculatePartQoH(event({}))
    expect(h.batchRecalculateQoH).not.toHaveBeenCalled()
  })
})
