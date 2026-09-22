// packages/lib/src/accounting/purchasing/vendor-credit/__tests__/apply-gate.test.ts
//
// 73 D1: the gate on an application is the LEDGER, not the bill's lifecycle -
// and "the ledger" means a POSTED entry.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  credit: {} as Record<string, unknown>,
  bill: {} as Record<string, unknown>,
  postings: [] as Array<Record<string, unknown>>,
}))

vi.mock('@auxx/database', async () => {
  const schema = await import('../../../../../../database/src/db/schema/index')
  const enums = await import('../../../../../../database/src/enums')
  return { schema, ...enums, database: {} }
})
vi.mock('../../../money/commands/run-money-command', () => ({
  runMoneyCommand: async (db: unknown, _input: unknown, body: (tx: unknown) => Promise<unknown>) =>
    body(db),
}))
vi.mock('../reads', () => ({
  requireVendorCredit: async () => h.credit,
  listVendorCreditApplications: vi.fn(),
  loadVendorCreditApplication: vi.fn(),
  sumVendorBillCreditApplications: async () => 0,
  sumVendorCreditApplications: async () => 0,
  sumVendorCreditRefunds: async () => 0,
}))
vi.mock('../../expense-bill/reads', () => ({ requireVendorBill: async () => h.bill }))
vi.mock('../../expense-bill/writes', () => ({ listVendorBillPostings: async () => h.postings }))

import type { Database } from '@auxx/database'
import { applyVendorCredit } from '../apply'

const db = {} as Database
const run = () =>
  applyVendorCredit(db, {
    organizationId: 'org_1',
    userId: 'user_1',
    vendorCreditInstanceId: 'vc_1',
    vendorBillInstanceId: 'ei_bill_1',
    amount: 10_000,
    commandKey: 'cmd_1',
  })

beforeEach(() => {
  h.credit = {
    id: 'vc_1',
    number: 'VC-0001',
    status: 'issued',
    totalMinor: 100_000,
    vendorCompanyInstanceId: 'ei_company_1',
  }
  h.bill = {
    id: 'ei_bill_1',
    internalNumber: 'BILL-0007',
    totalMinor: 250_000,
    vendorCompanyInstanceId: 'ei_company_1',
  }
  h.postings = []
})

describe('applyVendorCredit ledger gate', () => {
  it('refuses a bill with no entry at all', async () => {
    await expect(run()).rejects.toThrow(/not in the books yet/)
  })

  it('refuses a bill whose only entry has been reversed', async () => {
    h.postings = [
      {
        glPostingId: 'gp_1',
        docNumber: 'BILL-0007',
        status: 'reversed',
        postingType: 'vendor_bill',
      },
    ]
    await expect(run()).rejects.toThrow(/not in the books yet/)
  })

  // Past the gate: the vendor check below it is the next refusal, which is how
  // this asserts the gate LET a posted entry through.
  it('passes a posted entry through to the vendor check', async () => {
    h.postings = [
      {
        glPostingId: 'gp_1',
        docNumber: 'BILL-0007',
        status: 'posted',
        postingType: 'vendor_bill',
      },
    ]
    h.bill = { ...h.bill, vendorCompanyInstanceId: 'ei_company_2' }
    await expect(run()).rejects.toThrow(/different vendors/)
  })
})
