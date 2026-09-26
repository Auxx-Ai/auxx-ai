// packages/lib/src/accounting/work-items/__tests__/recovery.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  add: vi.fn(async (..._args: unknown[]) => {}),
}))

vi.mock('../../../jobs/queues', () => ({ getQueue: () => ({ add: h.add }) }))
vi.mock('../../../jobs/queues/types', () => ({ Queues: { maintenanceQueue: 'maintenance' } }))

import { requestPartPricing } from '../recovery'

beforeEach(() => {
  vi.clearAllMocks()
  h.add.mockResolvedValue(undefined)
})

describe('requestPartPricing', () => {
  it('queues pricePartsJob with the distinct part ids', async () => {
    await requestPartPricing('org_1', ['p1', 'p2', 'p1'])

    expect(h.add).toHaveBeenCalledTimes(1)
    expect(h.add.mock.calls[0]?.slice(0, 2)).toEqual([
      'pricePartsJob',
      { organizationId: 'org_1', partIds: ['p1', 'p2'] },
    ])
  })

  it('queues nothing for no parts', async () => {
    await requestPartPricing('org_1', [])
    expect(h.add).not.toHaveBeenCalled()
  })

  it('never throws; a failed enqueue falls back to a recovery run', async () => {
    h.add.mockRejectedValueOnce(new Error('redis down'))

    await expect(requestPartPricing('org_1', ['p1'])).resolves.toBeUndefined()
    expect(h.add).toHaveBeenCalledTimes(2)
    expect(h.add.mock.calls[1]?.slice(0, 2)).toEqual([
      'accountingRecoveryJob',
      { organizationId: 'org_1' },
    ])
  })
})
