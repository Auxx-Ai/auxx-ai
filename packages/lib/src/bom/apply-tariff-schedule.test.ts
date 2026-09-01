// packages/lib/src/bom/apply-tariff-schedule.test.ts
// 29 §8 / §12 (a): the explicit apply walks every classified offer to its part.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  rows: [] as Array<{ offerId: string; partId: string | null }>,
  recalculateAffectedParts: vi.fn(async (_orgId: string, _partIds: string[]) => [] as string[]),
  defId: 'vendor_part_def' as string | null,
  fields: {
    vendor_part_tariff_code: { id: 'f_vp_tariff_code' },
    vendor_part_part: { id: 'f_vp_part' },
  } as Record<string, { id: string } | null>,
}))

vi.mock('@auxx/database', () => ({
  schema: {
    EntityInstance: {
      id: 'id',
      organizationId: 'organizationId',
      entityDefinitionId: 'entityDefinitionId',
      archivedAt: 'archivedAt',
    },
    FieldValue: {
      entityId: 'entityId',
      fieldId: 'fieldId',
      organizationId: 'organizationId',
      relatedEntityId: 'relatedEntityId',
    },
  },
}))

vi.mock('drizzle-orm/pg-core', () => ({
  alias: (table: unknown) => table,
}))

vi.mock('../cache', () => ({
  getCachedEntityDefId: async () => h.defId,
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attrs: readonly string[]) =>
        Object.fromEntries(attrs.map((a) => [a, h.fields[a] ?? null])),
    }),
  }),
}))

vi.mock('./cost-calculator', () => ({
  recalculateAffectedParts: h.recalculateAffectedParts,
}))

import { applyTariffSchedule } from './apply-tariff-schedule'

const ORG = 'org_1'

const db = {
  select: () => ({
    from: () => ({
      innerJoin: () => ({
        innerJoin: () => ({ where: () => Promise.resolve(h.rows) }),
      }),
    }),
  }),
} as never

beforeEach(() => {
  vi.clearAllMocks()
  h.rows = []
  h.defId = 'vendor_part_def'
  h.fields = {
    vendor_part_tariff_code: { id: 'f_vp_tariff_code' },
    vendor_part_part: { id: 'f_vp_part' },
  }
})

describe('applyTariffSchedule', () => {
  it('recalculates each classified part once and reports what moved', async () => {
    // Two offers on the same part (dual-sourced), one on another.
    h.rows = [
      { offerId: 'vp_1', partId: 'part_a' },
      { offerId: 'vp_2', partId: 'part_a' },
      { offerId: 'vp_3', partId: 'part_b' },
    ]
    h.recalculateAffectedParts.mockResolvedValue(['part_a', 'part_parent'])

    const result = await applyTariffSchedule(db, ORG)

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toEqual({
      classifiedOffers: 3,
      affectedParts: 2,
      changedPartIds: ['part_a', 'part_parent'],
    })
    expect(h.recalculateAffectedParts).toHaveBeenCalledTimes(1)
    expect(h.recalculateAffectedParts).toHaveBeenCalledWith(ORG, ['part_a', 'part_b'])
  })

  it('writes nothing when no offer is classified', async () => {
    const result = await applyTariffSchedule(db, ORG)

    expect(result._unsafeUnwrap()).toEqual({
      classifiedOffers: 0,
      affectedParts: 0,
      changedPartIds: [],
    })
    expect(h.recalculateAffectedParts).not.toHaveBeenCalled()
  })

  it('is the empty result, not an error, for an org without the fields yet', async () => {
    h.fields = { vendor_part_tariff_code: null, vendor_part_part: { id: 'f_vp_part' } }
    h.rows = [{ offerId: 'vp_1', partId: 'part_a' }]

    const result = await applyTariffSchedule(db, ORG)

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().affectedParts).toBe(0)
    expect(h.recalculateAffectedParts).not.toHaveBeenCalled()
  })

  it('is the empty result for an org without a vendor_part definition', async () => {
    h.defId = null
    h.rows = [{ offerId: 'vp_1', partId: 'part_a' }]

    const result = await applyTariffSchedule(db, ORG)

    expect(result._unsafeUnwrap().classifiedOffers).toBe(0)
    expect(h.recalculateAffectedParts).not.toHaveBeenCalled()
  })
})
