// packages/lib/src/jobs/maintenance/__tests__/accounting-recovery-job.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  organizations: [] as Array<{ id: string; cursor: unknown }>,
  events: [] as string[],
  money: vi.fn(),
  receipt: vi.fn(),
  application: vi.fn(),
  delivery: vi.fn(),
}))
vi.mock('@auxx/database', () => ({
  schema: { Organization: {}, OrganizationSetting: {} },
  database: {
    select: () => ({
      from: () => ({
        leftJoin: () => ({ orderBy: () => ({ limit: async () => h.organizations }) }),
      }),
    }),
    insert: () => ({
      values: (value: { organizationId: string; value: unknown }) => ({
        onConflictDoUpdate: async () => {
          h.events.push(`cursor:${value.organizationId}:${value.value}`)
        },
      }),
    }),
  },
}))
vi.mock('../../../accounting/money/customer-money/ingest', () => ({
  sweepImportedCustomerMoney: h.money,
}))
vi.mock('../../../accounting/money/customer-money/accounting', () => ({
  sweepCustomerReceiptAccounting: h.receipt,
}))
vi.mock('../../../accounting/money/customer-money/deposit-application-accounting', () => ({
  sweepDepositApplicationAccounting: h.application,
}))
vi.mock('../../../accounting/export', () => ({ sweepExportBatches: h.delivery }))

import type { JobContext } from '../../types/job-context'
import { accountingRecoveryJob } from '../accounting-recovery-job'

beforeEach(() => {
  vi.clearAllMocks()
  h.events = []
  h.organizations = [
    { id: 'A', cursor: 'old-A' },
    { id: 'B', cursor: null },
  ]
  h.money.mockImplementation(async (_db, org) => {
    h.events.push(`money:${org}`)
  })
  h.receipt.mockImplementation(async (_db, input) => {
    h.events.push(`receipt:${input.organizationId}`)
  })
  h.application.mockImplementation(async (_db, input) => {
    h.events.push(`application:${input.organizationId}`)
  })
  h.delivery.mockImplementation(async (_db, input) => {
    h.events.push(`delivery:${input.organizationId}`)
  })
})
afterEach(() => vi.restoreAllMocks())
describe('accounting recovery organization rotation', () => {
  it('rotates each organization before provider work and saves progress before delivery', async () => {
    await accountingRecoveryJob({ jobId: 'fixture' } as JobContext)
    expect(h.events).toEqual([
      'cursor:A:old-A',
      'money:A',
      'receipt:A',
      'application:A',
      'delivery:A',
      'cursor:B:null',
      'money:B',
      'receipt:B',
      'application:B',
      'delivery:B',
    ])
    expect(h.delivery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: 'A', limit: 5, timeBudgetMs: expect.any(Number) })
    )
  })
  it('yields after its time budget so a slow provider cannot keep the whole organization page running', async () => {
    let now = 1_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    h.delivery.mockImplementation(async () => {
      now += 50_000
    })
    await accountingRecoveryJob({ jobId: 'fixture' } as JobContext)
    expect(h.money).toHaveBeenCalledTimes(1)
    expect(h.events).not.toContain('cursor:B:null')
  })

  it('continues delivery and the next organization when receipt accounting is blocked', async () => {
    h.receipt.mockRejectedValueOnce(new Error('Payment route unavailable'))
    await accountingRecoveryJob({ jobId: 'fixture' } as JobContext)
    expect(h.events).toContain('delivery:A')
    expect(h.events).toContain('receipt:B')
    expect(h.events).toContain('delivery:B')
  })
})
