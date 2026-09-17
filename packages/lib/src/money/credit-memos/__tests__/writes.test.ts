// packages/lib/src/money/credit-memos/__tests__/writes.test.ts
//
// One lane: `issueCreditMemo` posts through `postCreditMemoEntry`, and
// `voidCreditMemo` reverses through `reverseCreditMemoEntry`. There is no stamp
// field and no batch member to refuse (MIGRATION.md step 1b).

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  isAccountingEnabled: vi.fn(async () => true),
  memo: {} as Record<string, unknown>,
  lines: [] as unknown[],
  orderHadFulfillmentBefore: vi.fn(async () => false),
  buildCreditMemoEntry: vi.fn(),
  postCreditMemoEntry: vi.fn(),
  reverseCreditMemoEntry: vi.fn(),
  setValuesForEntity: vi.fn(),
  settleCreditMemo: vi.fn(async () => ({ status: 'issued' })),
  recomputeTotals: vi.fn(async () => {}),
  sumCreditMemoApplications: vi.fn(async () => 0),
  sumSucceededCreditMemoRefunds: vi.fn(async () => 0),
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
  getOrgCache: () => ({ from: () => ({ bySystemAttributes: async () => ({}) }) }),
}))
vi.mock('../../../postings/build-credit-memo-entry', () => ({
  buildCreditMemoEntry: h.buildCreditMemoEntry,
}))
vi.mock('../../../postings/period-lock', () => ({ resolvePeriodLock: vi.fn() }))
vi.mock('../../../postings/post-entry', () => ({
  LEDGER_CURRENCY: 'USD',
  previewEntry: vi.fn(),
}))
vi.mock('../accounting', () => ({
  postCreditMemoEntry: h.postCreditMemoEntry,
  reverseCreditMemoEntry: h.reverseCreditMemoEntry,
}))
vi.mock('../../../settings/settings-service', () => ({
  getOrganizationSetting: async () => null,
}))
vi.mock('../../../field-values/field-value-service', () => ({
  FieldValueService: class {
    setValuesForEntity = h.setValuesForEntity
  },
}))
vi.mock('../../totals-hooks', () => ({ recomputeTotals: h.recomputeTotals }))
vi.mock('../command', () => ({
  runCreditCommand: async (
    db: unknown,
    _input: unknown,
    execute: (tx: unknown) => Promise<unknown>
  ) => execute(db),
}))
vi.mock('../reads', () => ({
  requireCreditMemo: async () => h.memo,
  loadCreditMemoLines: async () => h.lines,
  orderHadFulfillmentBefore: h.orderHadFulfillmentBefore,
  loadInvoiceForCredit: vi.fn(),
  loadInvoiceLinesForCredit: vi.fn(),
  readOrderGateways: vi.fn(async () => []),
  sumCreditMemoApplications: h.sumCreditMemoApplications,
  sumSucceededCreditMemoRefunds: h.sumSucceededCreditMemoRefunds,
  sumReservedCreditMemoRefunds: async () =>
    h.memo.source === 'channel' ? h.memo.amountRefundedMinor : h.sumSucceededCreditMemoRefunds(),
}))
vi.mock('../settle', () => ({
  CREDIT_MEMO_STATUS_BYPASS: new Set(['credit_memo_status']),
  settleCreditMemo: h.settleCreditMemo,
}))

import type { Database } from '@auxx/database'
import { issueCreditMemo, voidCreditMemo } from '../writes'

const ORG = 'org_1'
const USER = 'user_1'
const MEMO_ID = 'cm_1'
const db = {} as Database
const input = { organizationId: ORG, userId: USER, creditMemoInstanceId: MEMO_ID }

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
  h.postCreditMemoEntry.mockResolvedValue({
    status: 'posted',
    glPostingId: 'gl_1',
    docNumber: 'AUXX-CRM-0001',
  })
  h.reverseCreditMemoEntry.mockResolvedValue({ status: 'posted', glPostingId: 'gl_rev' })
  h.settleCreditMemo.mockResolvedValue({ status: 'issued' })
  h.sumCreditMemoApplications.mockResolvedValue(0)
  h.sumSucceededCreditMemoRefunds.mockResolvedValue(0)
})

describe('issueCreditMemo', () => {
  it('posts one entry with the memo and its contact, and returns its ids', async () => {
    const result = await issueCreditMemo(db, input)

    expect(h.postCreditMemoEntry).toHaveBeenCalledTimes(1)
    expect(h.postCreditMemoEntry.mock.calls[0]![1]).toMatchObject({
      organizationId: ORG,
      creditMemoInstanceId: MEMO_ID,
      contactInstanceId: 'contact_1',
      orderInstanceId: null,
    })
    expect(result.postingId).toBe('gl_1')
    expect(result.docNumber).toBe('AUXX-CRM-0001')
  })

  it('writes the status with no posting stamp beside it', async () => {
    await issueCreditMemo(db, input)

    const write = h.setValuesForEntity.mock.calls[0]![0]
    expect(write.values).toEqual([{ fieldId: 'credit_memo_status', value: 'issued' }])
  })

  it('refuses the issue when the ledger refuses the entry', async () => {
    h.postCreditMemoEntry.mockResolvedValueOnce({ status: 'period_closed', error: 'August closed' })

    await expect(issueCreditMemo(db, input)).rejects.toThrow('could not be posted')
    expect(h.setValuesForEntity).not.toHaveBeenCalled()
  })

  // accounting is opt-in (task 17 §3): nothing is built, and nothing is posted.
  it('issues without building or posting when accounting is off', async () => {
    h.isAccountingEnabled.mockResolvedValue(false)

    const result = await issueCreditMemo(db, input)

    expect(h.buildCreditMemoEntry).not.toHaveBeenCalled()
    expect(h.postCreditMemoEntry).not.toHaveBeenCalled()
    expect(h.orderHadFulfillmentBefore).not.toHaveBeenCalled()
    expect(result.postingId).toBeNull()
  })

  it('refuses a memo with no number before anything is written', async () => {
    h.memo.number = ''

    await expect(issueCreditMemo(db, input)).rejects.toThrow('has no number yet')
    expect(h.setValuesForEntity).not.toHaveBeenCalled()
  })
})

describe('voidCreditMemo', () => {
  beforeEach(() => {
    h.memo.status = 'issued'
    h.memo.source = 'channel'
  })

  it('reverses the memo posting, then sets void', async () => {
    await voidCreditMemo(db, input)

    expect(h.reverseCreditMemoEntry).toHaveBeenCalledTimes(1)
    expect(h.setValuesForEntity).toHaveBeenCalledTimes(1)
    const write = h.setValuesForEntity.mock.calls[0]![0]
    expect(write.values).toEqual([{ fieldId: 'credit_memo_status', value: 'void' }])
  })

  it('voids an unposted memo, because there is nothing standing to reverse', async () => {
    h.reverseCreditMemoEntry.mockResolvedValue(null)

    await voidCreditMemo(db, input)

    expect(h.setValuesForEntity).toHaveBeenCalledTimes(1)
  })

  it('refuses the void when the reversal is refused', async () => {
    h.reverseCreditMemoEntry.mockResolvedValue({ status: 'period_closed', error: 'August closed' })

    await expect(voidCreditMemo(db, input)).rejects.toThrow('could not be reversed')
    expect(h.setValuesForEntity).not.toHaveBeenCalled()
  })

  it('refuses a refunded memo before it touches the ledger', async () => {
    h.memo.amountRefundedMinor = 50_00

    await expect(voidCreditMemo(db, input)).rejects.toThrow('has a completed or pending refund')
    expect(h.reverseCreditMemoEntry).not.toHaveBeenCalled()
  })

  it('refuses an applied memo before it touches the ledger', async () => {
    h.sumCreditMemoApplications.mockResolvedValue(25_00)

    await expect(voidCreditMemo(db, input)).rejects.toThrow('Unapply this credit memo')
    expect(h.reverseCreditMemoEntry).not.toHaveBeenCalled()
  })

  it('refuses an already-void memo', async () => {
    h.memo.status = 'void'

    await expect(voidCreditMemo(db, input)).rejects.toThrow('is already void')
  })

  it('voids a channel draft with no reversal at all', async () => {
    h.memo.status = 'draft'

    await voidCreditMemo(db, input)

    expect(h.reverseCreditMemoEntry).not.toHaveBeenCalled()
    expect(h.setValuesForEntity).toHaveBeenCalledTimes(1)
  })
})
