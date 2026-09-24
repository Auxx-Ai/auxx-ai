// packages/lib/src/accounting/connect-and-go/__tests__/backlog-preview.test.ts

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  windows: [] as unknown[],
  mode: 'transaction' as 'transaction' | 'summary',
  grain: 'day' as 'day' | 'month' | 'payout',
  movementRows: { count: 420, days: 200, months: 9 },
  recordMoney: { count: 0, days: 0, months: 0 },
  acceptances: 30,
  unbridged: 0,
}))

vi.mock('../../../settings/read', () => ({
  readOrganizationSettings: async () => ({ 'accounting.bookTimeZone': 'America/Chicago' }),
}))
vi.mock('../../sales/fulfillments/posting-reads', () => ({
  countFulfillmentAccountingBacklog: async (_db: unknown, _org: string, window: unknown) => {
    h.windows.push(window)
    return { count: 15_000, days: 250, months: 9 }
  },
}))
vi.mock('../../money/blocked-movements', () => ({
  countMovementAccountingBacklog: async () => h.movementRows,
}))
vi.mock('../../money/customer-money/ingest', () => ({
  countImportedCustomerMoneyBacklog: async () => h.acceptances,
}))
vi.mock('../../money/customer-money/bridge-sweep', () => ({
  countUnmaterializedCustomerTransactions: async () => h.recordMoney,
  countUnbridgedFinancialRecords: async () => h.unbridged,
}))
vi.mock('../../work-items/sweep', () => ({
  countWorkItemsAtStage: async () => 7,
}))
vi.mock('../../ledger/setup/read-export-settings', () => ({
  readExportSettings: async () => ({
    mode: h.mode,
    cutover: null,
    autoSend: {},
    summaryGrain: { fulfillment: h.grain, receipt: h.grain },
  }),
}))

import { previewConnectAndGoBacklog } from '../backlog-preview'

const db = {} as Database

beforeEach(() => {
  h.windows = []
  h.mode = 'transaction'
  h.grain = 'day'
  h.movementRows = { count: 420, days: 200, months: 9 }
  h.recordMoney = { count: 0, days: 0, months: 0 }
  h.acceptances = 30
  h.unbridged = 0
})

describe('previewConnectAndGoBacklog', () => {
  it('counts after the proposed cutover in the book zone and estimates the drain', async () => {
    const preview = (
      await previewConnectAndGoBacklog(db, { organizationId: 'org_1', cutoffPeriod: '2025-12' })
    )._unsafeUnwrap()

    expect(h.windows).toEqual([{ cutoffPeriod: '2025-12', bookTimeZone: 'America/Chicago' }])
    expect(preview).toMatchObject({
      shipments: 15_000,
      movements: 420,
      relief: 7,
      importedPayments: 30,
      exportMode: 'transaction',
      estimatedExports: 15_420,
      drainMinutes: 150,
    })
  })

  it('estimates summary exports as one object per grain bucket', async () => {
    h.mode = 'summary'
    const byDay = (
      await previewConnectAndGoBacklog(db, { organizationId: 'org_1', cutoffPeriod: '2025-12' })
    )._unsafeUnwrap()
    expect(byDay.estimatedExports).toBe(450)

    h.grain = 'month'
    const byMonth = (
      await previewConnectAndGoBacklog(db, { organizationId: 'org_1', cutoffPeriod: '2025-12' })
    )._unsafeUnwrap()
    expect(byMonth.estimatedExports).toBe(18)
  })

  it('in draft, counts the records: nothing has materialized or accepted yet', async () => {
    h.movementRows = { count: 0, days: 0, months: 0 }
    h.acceptances = 0
    h.recordMoney = { count: 900, days: 120, months: 5 }
    h.unbridged = 1_200

    const preview = (
      await previewConnectAndGoBacklog(db, { organizationId: 'org_1', cutoffPeriod: '2025-12' })
    )._unsafeUnwrap()
    expect(preview.movements).toBe(900)
    expect(preview.importedPayments).toBe(1_200)
    expect(preview.estimatedExports).toBe(15_900)

    h.mode = 'summary'
    const summary = (
      await previewConnectAndGoBacklog(db, { organizationId: 'org_1', cutoffPeriod: '2025-12' })
    )._unsafeUnwrap()
    expect(summary.estimatedExports).toBe(250 + 120)
  })

  it('refuses a malformed month', async () => {
    const result = await previewConnectAndGoBacklog(db, {
      organizationId: 'org_1',
      cutoffPeriod: 'December',
    })
    expect(result.isErr()).toBe(true)
  })
})
