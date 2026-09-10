// packages/lib/src/money/credit-memos/__tests__/writes.test.ts
//
// plans/accounting/tasks/17-accounting-is-opt-in.md section 3: `issueCreditMemo`
// checks the accounting-off case before `orderHadFulfillmentBefore` (a read
// that exists only to decide the builder's `reverseRevenue`) and before the
// builder itself - so a native credit memo issues on an org that has never
// turned accounting on exactly as it would on one that has.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  isAccountingEnabled: vi.fn(async () => true),
  memo: {} as Record<string, unknown>,
  lines: [] as unknown[],
  orderHadFulfillmentBefore: vi.fn(async () => false),
  buildCreditMemoEntry: vi.fn(),
  resolvePeriodLock: vi.fn(),
  postEntry: vi.fn(),
  setValuesForEntity: vi.fn(),
  settleCreditMemo: vi.fn(async () => ({ status: 'issued' })),
  recomputeTotals: vi.fn(async () => {}),
}))

vi.mock('@auxx/database', async () => {
  const schema = await import('../../../../../database/src/db/schema/index')
  const enums = await import('../../../../../database/src/enums')
  return { schema, ...enums, database: {} }
})
vi.mock('../../../postings/accounting-enabled', () => ({
  isAccountingEnabled: h.isAccountingEnabled,
}))
vi.mock('../../../cache', () => ({
  getEntityDefIdResolver: async () => (type: string) => type,
}))
vi.mock('../../../postings/build-credit-memo-entry', () => ({
  CREDIT_MEMO_POSTING_TYPE: 'credit_memo',
  CREDIT_MEMO_SOURCE_TYPE: 'credit_memo',
  buildCreditMemoEntry: h.buildCreditMemoEntry,
}))
vi.mock('../../../postings/list-postings', () => ({
  listPostingsForSource: vi.fn(async () => ({ isOk: () => true, value: [] })),
}))
vi.mock('../../../postings/period-lock', () => ({
  resolvePeriodLock: h.resolvePeriodLock,
}))
vi.mock('../../../postings/post-entry', () => ({
  LEDGER_CURRENCY: 'USD',
  postEntry: h.postEntry,
  previewEntry: vi.fn(),
}))
vi.mock('../../../postings/reverse-entry', () => ({ reverseEntry: vi.fn() }))
vi.mock('../../../settings/settings-service', () => ({
  getOrganizationSetting: async () => null,
}))
vi.mock('../../../field-values/field-value-service', () => ({
  FieldValueService: class {
    setValuesForEntity = h.setValuesForEntity
  },
}))
vi.mock('../../totals-hooks', () => ({ recomputeTotals: h.recomputeTotals }))
vi.mock('../reads', () => ({
  requireCreditMemo: async () => h.memo,
  loadCreditMemoLines: async () => h.lines,
  orderHadFulfillmentBefore: h.orderHadFulfillmentBefore,
  loadInvoiceForCredit: vi.fn(),
  loadInvoiceLinesForCredit: vi.fn(),
  sumCreditMemoApplications: vi.fn(async () => 0),
  sumSucceededCreditMemoRefunds: vi.fn(async () => 0),
}))
vi.mock('../settle', () => ({
  CREDIT_MEMO_STATUS_BYPASS: new Set(['credit_memo_status']),
  settleCreditMemo: h.settleCreditMemo,
}))

import type { Database } from '@auxx/database'
import { issueCreditMemo } from '../writes'

const ORG = 'org_1'
const USER = 'user_1'
const MEMO_ID = 'cm_1'
const db = {} as Database

beforeEach(() => {
  vi.clearAllMocks()
  h.isAccountingEnabled.mockResolvedValue(true)
  h.memo = {
    id: MEMO_ID,
    number: 'CM-0001',
    status: 'draft',
    source: 'native',
    reason: null,
    issuedAt: '2026-09-01',
    note: null,
    contactInstanceId: 'contact_1',
    invoiceInstanceId: null,
    orderInstanceId: null,
    subtotalMinor: 100_00,
    taxTotalMinor: 0,
    totalMinor: 100_00,
    amountAppliedMinor: 0,
    amountRefundedMinor: 0,
    balanceMinor: 100_00,
    lineIds: ['line_1'],
    hasSettlementFields: true,
  }
  h.lines = [
    {
      id: 'line_1',
      description: 'Widget',
      qty: 1,
      unitPriceMinor: 100_00,
      subtotalMinor: 100_00,
      taxTotalMinor: null,
      disposition: null,
      lineItemInstanceId: null,
      sortOrder: 0,
    },
  ]
  h.orderHadFulfillmentBefore.mockResolvedValue(false)
  h.buildCreditMemoEntry.mockReturnValue({
    entry: { postingType: 'credit_memo', periodKey: 'CM-0001', txnDate: '2026-09-01', lines: [] },
  })
  h.resolvePeriodLock.mockResolvedValue({ lockedThroughMonth: null })
  h.postEntry.mockResolvedValue({
    status: 'posted',
    glPostingId: 'gl_1',
    docNumber: 'AUXX-CRM-0001',
  })
  h.settleCreditMemo.mockResolvedValue({ status: 'issued' })
})

describe('accounting not enabled', () => {
  beforeEach(() => {
    h.isAccountingEnabled.mockResolvedValue(false)
  })

  it('issues the memo without building, locking, or posting an entry', async () => {
    const result = await issueCreditMemo(db, {
      organizationId: ORG,
      userId: USER,
      creditMemoInstanceId: MEMO_ID,
    })

    expect(result.postingId).toBeNull()
    expect(result.docNumber).toBeNull()
    expect(h.buildCreditMemoEntry).not.toHaveBeenCalled()
    expect(h.resolvePeriodLock).not.toHaveBeenCalled()
    expect(h.postEntry).not.toHaveBeenCalled()
    // The read that exists only to decide the builder's `reverseRevenue`.
    expect(h.orderHadFulfillmentBefore).not.toHaveBeenCalled()
  })

  it('still flips the status to issued', async () => {
    await issueCreditMemo(db, {
      organizationId: ORG,
      userId: USER,
      creditMemoInstanceId: MEMO_ID,
    })

    expect(h.setValuesForEntity).toHaveBeenCalledTimes(1)
    const write = h.setValuesForEntity.mock.calls[0]![0]
    expect(write.values).toContainEqual({ fieldId: 'credit_memo_status', value: 'issued' })
  })
})

describe('accounting enabled', () => {
  it('builds, locks, and posts before flipping the status', async () => {
    const result = await issueCreditMemo(db, {
      organizationId: ORG,
      userId: USER,
      creditMemoInstanceId: MEMO_ID,
    })

    expect(h.buildCreditMemoEntry).toHaveBeenCalledTimes(1)
    expect(h.postEntry).toHaveBeenCalledTimes(1)
    expect(result.postingId).toBe('gl_1')
  })
})
