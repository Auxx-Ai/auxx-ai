// packages/lib/src/jobs/maintenance/__tests__/accounting-recovery-job.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  organizations: [] as string[],
  events: [] as string[],
  orgs: vi.fn(),
  bridge: vi.fn(),
  money: vi.fn(),
  receipt: vi.fn(),
  shipment: vi.fn(),
  delivery: vi.fn(),
}))
vi.mock('@auxx/database', () => ({ database: {} }))
vi.mock('../../../accounting/work-items/sweep', () => ({ listOrganizationsForSweep: h.orgs }))
vi.mock('../../../accounting/money/customer-money/bridge-sweep', () => ({
  sweepFinancialRecordBridge: h.bridge,
}))
vi.mock('../../../accounting/money/customer-money/ingest', () => ({
  sweepImportedCustomerMoney: h.money,
}))
vi.mock('../../../accounting/money/blocked-movements', () => ({
  sweepMovementAccounting: h.receipt,
}))
vi.mock('../../../accounting/sales/credit-memos/issue-pass', () => ({
  sweepChannelCreditMemos: vi.fn(async () => ({ scanned: 0, issued: 0, blocked: 0 })),
}))
vi.mock('../../../accounting/sales/fulfillments/accounting-sweep', () => ({
  sweepFulfillmentAccounting: h.shipment,
}))
vi.mock('../../../accounting/export', () => ({ sweepExportBatches: h.delivery }))

import type { JobContext } from '../../types/job-context'
import { accountingRecoveryJob } from '../accounting-recovery-job'

const record =
  (name: string) => async (_db: unknown, input: { organizationId: string } | string) => {
    h.events.push(`${name}:${typeof input === 'string' ? input : input.organizationId}`)
  }

beforeEach(() => {
  vi.clearAllMocks()
  h.events = []
  h.organizations = ['A', 'B']
  h.orgs.mockImplementation(async () => h.organizations)
  h.bridge.mockImplementation(record('bridge'))
  h.money.mockImplementation(record('money'))
  h.receipt.mockImplementation(record('receipt'))
  h.shipment.mockImplementation(record('shipment'))
  h.delivery.mockImplementation(record('delivery'))
})
afterEach(() => vi.restoreAllMocks())

describe('accounting recovery job', () => {
  it('visits the orgs the work-item frame names and runs every lane for each', async () => {
    await accountingRecoveryJob({ jobId: 'fixture' } as JobContext)
    expect(h.orgs).toHaveBeenCalledWith(expect.anything(), { limit: 25 })
    for (const org of ['A', 'B'])
      for (const lane of ['bridge', 'money', 'receipt', 'shipment', 'delivery'])
        expect(h.events).toContain(`${lane}:${org}`)
    expect(h.shipment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: 'A', limit: 100, timeBudgetMs: expect.any(Number) })
    )
    expect(h.delivery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: 'A', limit: 5, timeBudgetMs: expect.any(Number) })
    )
  })

  it('no ordering between the movement and shipment sweeps is load-bearing', async () => {
    // Each sweep gets only its org and budget - nothing the other produced - and a
    // refusal in either leaves the other to run.
    h.receipt.mockRejectedValueOnce(new Error('Payment route unavailable'))
    h.shipment.mockRejectedValueOnce(new Error('Shipment route unavailable'))
    await accountingRecoveryJob({ jobId: 'fixture' } as JobContext)
    for (const sweep of [h.receipt, h.shipment])
      for (const call of sweep.mock.calls)
        expect(Object.keys(call[1]).sort()).toEqual(['limit', 'organizationId', 'timeBudgetMs'])
    expect(h.shipment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: 'A' })
    )
    expect(h.receipt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: 'B' })
    )
    expect(h.events).toContain('delivery:A')
    expect(h.events).toContain('shipment:B')
  })

  it('yields after its time budget so a slow provider cannot hold the whole page', async () => {
    let now = 1_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    h.delivery.mockImplementation(async () => {
      now += 50_000
    })
    await accountingRecoveryJob({ jobId: 'fixture' } as JobContext)
    expect(h.money).toHaveBeenCalledTimes(1)
    expect(h.events).not.toContain('bridge:B')
  })

  it('continues delivery and the next organization when the evidence lanes fail', async () => {
    h.bridge.mockRejectedValueOnce(new Error('bridge down'))
    h.money.mockRejectedValueOnce(new Error('ingest down'))
    await accountingRecoveryJob({ jobId: 'fixture' } as JobContext)
    expect(h.events).toContain('receipt:A')
    expect(h.events).toContain('delivery:A')
    expect(h.events).toContain('delivery:B')
  })
})
