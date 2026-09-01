// packages/lib/src/field-hooks/post/tariff-rate-triggers.test.ts
// 29 §7: the two-join widening from a rate row to the parts it reprices.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  batchResolvePartIds: vi.fn(),
  recalculatePartCostsForParts: vi.fn(async () => {}),
  findRelated: vi.fn(),
}))

vi.mock('./bom-cost-triggers', () => ({
  batchResolvePartIds: h.batchResolvePartIds,
  recalculatePartCostsForParts: h.recalculatePartCostsForParts,
}))
vi.mock('../pre/related-rows', () => ({ findRelatedInstanceIds: h.findRelated }))

import { recalculatePartCostForTariffRates } from './tariff-rate-triggers'

const ORG = 'org_1'

beforeEach(() => {
  vi.clearAllMocks()
  h.findRelated.mockResolvedValue([])
  h.batchResolvePartIds.mockResolvedValue([])
})

describe('recalculatePartCostForTariffRates', () => {
  it('walks rate -> code -> offers -> parts and recalculates once', async () => {
    h.findRelated.mockResolvedValue(['vp_1', 'vp_2'])
    h.batchResolvePartIds.mockResolvedValue(['part_a', 'part_b'])

    await recalculatePartCostForTariffRates({
      organizationId: ORG,
      rateInstanceIds: ['rate_1'],
      values: { rate_1: { tariff_rate_tariff_code: 'tcdef:code_cn' } },
    })

    // The code came threaded, so the only `batchResolvePartIds` call is offers -> parts.
    expect(h.batchResolvePartIds).toHaveBeenCalledTimes(1)
    expect(h.batchResolvePartIds).toHaveBeenCalledWith(['vp_1', 'vp_2'], ORG, 'vendor_part_part')
    expect(h.findRelated).toHaveBeenCalledWith(ORG, 'vendor_part', 'vendor_part_tariff_code', [
      'code_cn',
    ])
    expect(h.recalculatePartCostsForParts).toHaveBeenCalledWith(ORG, ['part_a', 'part_b'])
  })

  it('reads the code from the row when the firing carried no values', async () => {
    h.batchResolvePartIds
      .mockResolvedValueOnce(['code_de']) // rate -> code
      .mockResolvedValueOnce(['part_x']) // offers -> parts
    h.findRelated.mockResolvedValue(['vp_9'])

    await recalculatePartCostForTariffRates({ organizationId: ORG, rateInstanceIds: ['rate_2'] })

    expect(h.batchResolvePartIds).toHaveBeenNthCalledWith(
      1,
      ['rate_2'],
      ORG,
      'tariff_rate_tariff_code'
    )
    expect(h.recalculatePartCostsForParts).toHaveBeenCalledWith(ORG, ['part_x'])
  })

  it('does nothing when no offer is classified under the code', async () => {
    await recalculatePartCostForTariffRates({
      organizationId: ORG,
      rateInstanceIds: ['rate_1'],
      values: { rate_1: { tariff_rate_tariff_code: 'code_cn' } },
    })
    expect(h.recalculatePartCostsForParts).not.toHaveBeenCalled()
  })

  it('dedupes codes across a batch of rates', async () => {
    h.findRelated.mockResolvedValue(['vp_1'])
    h.batchResolvePartIds.mockResolvedValue(['part_a'])

    await recalculatePartCostForTariffRates({
      organizationId: ORG,
      rateInstanceIds: ['r1', 'r2', 'r3'],
      values: {
        r1: { tariff_rate_tariff_code: 'code_cn' },
        r2: { tariff_rate_tariff_code: 'code_cn' },
        r3: { tariff_rate_tariff_code: 'code_cn' },
      },
    })

    expect(h.findRelated).toHaveBeenCalledWith(ORG, 'vendor_part', 'vendor_part_tariff_code', [
      'code_cn',
    ])
  })
})
