// packages/lib/src/field-hooks/pre/tariff-code-delete-guard.test.ts
// plans/money/tasks/30-tariff-offer-surfaces.md §9.1: refuse while an offer is
// classified under the code, cascade the rate rows otherwise.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BadRequestError } from '../../errors'
import type { EntityPreDeleteEvent } from '../types'

const h = vi.hoisted(() => ({
  findRelated: vi.fn(),
  del: vi.fn(),
}))

vi.mock('../../resources/crud', () => ({
  UnifiedCrudHandler: class {
    delete = h.del
  },
}))
vi.mock('./related-rows', () => ({ findRelatedInstanceIds: h.findRelated }))

import { guardTariffCodeDelete } from './tariff-code-delete-guard'

const CODE_DEF = 'tc0def00000000000000000001'
const CODE_ID = 'tc0id000000000000000000001'
const ORG = 'org_1'

function event(): EntityPreDeleteEvent {
  return {
    recordId: `${CODE_DEF}:${CODE_ID}` as EntityPreDeleteEvent['recordId'],
    entityDefinitionId: CODE_DEF,
    entityType: 'tariff_code',
    entitySlug: 'tariff-codes',
    values: {},
    organizationId: ORG,
    userId: 'usr_1',
    bypass: new Set(),
  }
}

/** Route `findRelatedInstanceIds` by child type. */
function related(offers: string[], rates: string[]) {
  h.findRelated.mockImplementation(async (_org: string, childType: string) =>
    childType === 'vendor_part' ? offers : childType === 'tariff_rate' ? rates : []
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  h.del.mockResolvedValue(undefined)
})

describe('guardTariffCodeDelete', () => {
  it('refuses while any supplier offer points at the code, and deletes nothing', async () => {
    related(['vp_1', 'vp_2', 'vp_3'], ['rate_1'])

    await expect(guardTariffCodeDelete(event())).rejects.toBeInstanceOf(BadRequestError)
    await expect(guardTariffCodeDelete(event())).rejects.toThrow(/3 supplier prices are classified/)
    expect(h.del).not.toHaveBeenCalled()
  })

  it('reads the offer count with `vendor_part_tariff_code`, archived rows included', async () => {
    related(['vp_1'], [])
    await expect(guardTariffCodeDelete(event())).rejects.toThrow(/1 supplier price is classified/)
    expect(h.findRelated).toHaveBeenCalledWith(ORG, 'vendor_part', 'vendor_part_tariff_code', [
      CODE_ID,
    ])
  })

  it('cascades the rate rows through the handler when no offer is classified', async () => {
    related([], ['rate_a', 'rate_b'])

    await guardTariffCodeDelete(event())

    expect(h.del).toHaveBeenCalledTimes(2)
    expect(h.del.mock.calls.map((call) => call[0])).toEqual([
      'tariff_rate:rate_a',
      'tariff_rate:rate_b',
    ])
  })

  it('is a no-op for a code with neither offers nor rates', async () => {
    related([], [])
    await guardTariffCodeDelete(event())
    expect(h.del).not.toHaveBeenCalled()
  })
})
