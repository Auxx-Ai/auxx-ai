// packages/lib/src/field-hooks/post/bom-cost-triggers.test.ts
// B2 §9: the batch entity-change cost recalc. Threaded parent parts skip the DB lookup;
// only records missing a parent hit ONE batched query; all parents dedupe into a single
// recalc; a delete with no resolvable parent falls back to a full-org recalc.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  recalculateAffectedParts: vi.fn(async () => {}),
  recalculateAllPartCosts: vi.fn(async () => {}),
  where: vi.fn(async () => [] as Array<{ relatedEntityId: string | null }>),
}))

vi.mock('../../bom/cost-calculator', () => ({
  recalculateAffectedParts: h.recalculateAffectedParts,
  recalculateAllPartCosts: h.recalculateAllPartCosts,
}))
vi.mock('@auxx/database', () => ({
  database: {
    select: () => ({ from: () => ({ innerJoin: () => ({ where: h.where }) }) }),
  },
  schema: {
    FieldValue: { relatedEntityId: 'r', entityId: 'e', organizationId: 'o', fieldId: 'f' },
    CustomField: { id: 'id', systemAttribute: 'sa' },
  },
}))

import { recalculatePartCostForEntityBatch } from './bom-cost-triggers'

beforeEach(() => {
  vi.clearAllMocks()
  h.where.mockResolvedValue([])
})

describe('recalculatePartCostForEntityBatch', () => {
  it('uses threaded parents, dedupes, and never hits the DB when all are present', async () => {
    await recalculatePartCostForEntityBatch({
      organizationId: 'org_1',
      relationshipAttr: 'vendor_part_part',
      action: 'created',
      records: [
        { entityInstanceId: 'v1', values: { vendor_part_part: 'p1' } },
        { entityInstanceId: 'v2', values: { vendor_part_part: 'p1' } }, // dup parent
        { entityInstanceId: 'v3', values: { vendor_part_part: 'p2' } },
      ],
    })
    expect(h.where).not.toHaveBeenCalled() // no missing → no lookup
    expect(h.recalculateAffectedParts).toHaveBeenCalledTimes(1)
    const parts = (h.recalculateAffectedParts.mock.calls[0] as unknown[])[1] as string[]
    expect([...parts].sort()).toEqual(['p1', 'p2'])
  })

  it('runs ONE lookup for the records missing a threaded parent', async () => {
    h.where.mockResolvedValue([{ relatedEntityId: 'p9' }])
    await recalculatePartCostForEntityBatch({
      organizationId: 'org_1',
      relationshipAttr: 'vendor_part_part',
      action: 'created',
      records: [
        { entityInstanceId: 'v1', values: { vendor_part_part: 'p1' } },
        { entityInstanceId: 'v2' }, // missing → looked up
      ],
    })
    expect(h.where).toHaveBeenCalledTimes(1)
    const parts = (h.recalculateAffectedParts.mock.calls[0] as unknown[])[1] as string[]
    expect([...parts].sort()).toEqual(['p1', 'p9'])
  })

  it('falls back to a full-org recalc on a delete with no resolvable parent', async () => {
    h.where.mockResolvedValue([]) // lookup finds nothing
    await recalculatePartCostForEntityBatch({
      organizationId: 'org_1',
      relationshipAttr: 'vendor_part_part',
      action: 'deleted',
      records: [{ entityInstanceId: 'v1' }],
    })
    expect(h.recalculateAllPartCosts).toHaveBeenCalledWith('org_1')
    expect(h.recalculateAffectedParts).not.toHaveBeenCalled()
  })

  it('does NOT full-org recalc on a create with no resolvable parent', async () => {
    h.where.mockResolvedValue([])
    await recalculatePartCostForEntityBatch({
      organizationId: 'org_1',
      relationshipAttr: 'vendor_part_part',
      action: 'created',
      records: [{ entityInstanceId: 'v1' }],
    })
    expect(h.recalculateAllPartCosts).not.toHaveBeenCalled()
    expect(h.recalculateAffectedParts).not.toHaveBeenCalled()
  })
})
