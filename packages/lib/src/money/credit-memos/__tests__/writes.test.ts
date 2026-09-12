// packages/lib/src/money/credit-memos/__tests__/writes.test.ts
//
// plans/accounting/tasks/17-accounting-is-opt-in.md section 3: `issueCreditMemo`
// checks the accounting-off case before `orderHadFulfillmentBefore` (a read
// that exists only to decide the builder's `reverseRevenue`) and before the
// builder itself - so a native credit memo issues on an org that has never
// turned accounting on exactly as it would on one that has.
//
// plans/accounting/tasks/25-batch-posting-and-credit-memos.md section 2.1:
// `voidCreditMemo` REFUSES a memo whose live posting summarises it, rather than
// reversing a period entry that covers hundreds of other memos.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  isAccountingEnabled: vi.fn(async () => true),
  memo: {} as Record<string, unknown>,
  lines: [] as unknown[],
  customFields: {} as Record<string, { id: string } | null>,
  orderHadFulfillmentBefore: vi.fn(async () => false),
  buildCreditMemoEntry: vi.fn(),
  resolvePeriodLock: vi.fn(),
  postEntry: vi.fn(),
  listPostingsForSource: vi.fn(),
  reverseEntry: vi.fn(),
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
  getOrgCache: () => ({
    from: () => ({ bySystemAttributes: async () => h.customFields }),
  }),
}))
vi.mock('../../../postings/build-credit-memo-entry', () => ({
  CREDIT_MEMO_POSTING_TYPE: 'credit_memo',
  CREDIT_MEMO_SOURCE_TYPE: 'credit_memo',
  buildCreditMemoEntry: h.buildCreditMemoEntry,
}))
vi.mock('../../../postings/list-postings', () => ({
  listPostingsForSource: h.listPostingsForSource,
}))
vi.mock('../../../postings/period-lock', () => ({
  resolvePeriodLock: h.resolvePeriodLock,
}))
vi.mock('../../../postings/post-entry', () => ({
  LEDGER_CURRENCY: 'USD',
  postEntry: h.postEntry,
  previewEntry: vi.fn(),
}))
vi.mock('../../../postings/reverse-entry', () => ({ reverseEntry: h.reverseEntry }))
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
  readOrderGateways: vi.fn(async () => []),
  sumCreditMemoApplications: h.sumCreditMemoApplications,
  sumSucceededCreditMemoRefunds: h.sumSucceededCreditMemoRefunds,
}))
vi.mock('../settle', () => ({
  CREDIT_MEMO_STATUS_BYPASS: new Set(['credit_memo_status']),
  settleCreditMemo: h.settleCreditMemo,
}))

import type { Database } from '@auxx/database'
import { AuxxError } from '../../../errors'
import { issueCreditMemo, voidCreditMemo } from '../writes'

const ORG = 'org_1'
const USER = 'user_1'
const MEMO_ID = 'cm_1'
const db = {} as Database

/**
 * A drizzle-shaped query builder that answers each `await` with the next queued
 * row set. Every builder method returns the same thenable, so a whole
 * `select().from().where().limit()` chain is one answer, in call order.
 */
function fakeDb(...answers: unknown[][]): { db: Database; select: ReturnType<typeof vi.fn> } {
  const queue = [...answers]
  const chain: Record<string, unknown> = {}
  const select = vi.fn(() => chain)
  chain.select = select
  for (const method of ['selectDistinct', 'from', 'innerJoin', 'where', 'orderBy', 'limit']) {
    chain[method] = () => chain
  }
  // biome-ignore lint/suspicious/noThenProperty: a drizzle builder is thenable; so is this double
  chain.then = (resolve: (rows: unknown[]) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(queue.shift() ?? []).then(resolve, reject)
  return { db: chain as unknown as Database, select }
}

/** A live posting header row, as the batch probe selects it. */
function postingRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    docNumber: 'AUXX-CRM-202601',
    periodKey: '2026-01',
    status: 'posted',
    ...over,
  }
}

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
    glPostingId: null,
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
  h.customFields = { credit_memo_gl_posting: { id: 'field_gl_posting' } }
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
  h.listPostingsForSource.mockResolvedValue({ isOk: () => true, value: [] })
  h.reverseEntry.mockResolvedValue({ status: 'posted' })
  h.sumCreditMemoApplications.mockResolvedValue(0)
  h.sumSucceededCreditMemoRefunds.mockResolvedValue(0)
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

  // 🛑 Brief 25 §4.2. `credit-memo-posting/reads.ts` decides "unposted" from
  // this stamp ALONE, so a memo issued here with an entry in the books but no
  // stamp is offered by the next netting read and posted a SECOND time inside
  // a period entry. The same rule drives `countUnpostedCreditMemos`, so it
  // would also refuse the month close forever.
  it('stamps the posting id in the same write as the status', async () => {
    await issueCreditMemo(db, {
      organizationId: ORG,
      userId: USER,
      creditMemoInstanceId: MEMO_ID,
    })

    expect(h.setValuesForEntity).toHaveBeenCalledTimes(1)
    const write = h.setValuesForEntity.mock.calls[0]![0]
    expect(write.values).toContainEqual({ fieldId: 'credit_memo_status', value: 'issued' })
    expect(write.values).toContainEqual({ fieldId: 'credit_memo_gl_posting', value: 'gl_1' })
  })

  it('writes no stamp when the post produced no posting id', async () => {
    h.postEntry.mockResolvedValueOnce({ status: 'posted', glPostingId: null, docNumber: null })

    await issueCreditMemo(db, {
      organizationId: ORG,
      userId: USER,
      creditMemoInstanceId: MEMO_ID,
    })

    const write = h.setValuesForEntity.mock.calls[0]![0]
    expect(
      (write.values as Array<{ fieldId: string }>).some(
        (v) => v.fieldId === 'credit_memo_gl_posting'
      )
    ).toBe(false)
  })
})

// ─── Brief 25 §2.1: a batched member is not voided in place ─────────────────

describe('voidCreditMemo, memo inside a batched entry', () => {
  beforeEach(() => {
    h.memo.status = 'issued'
    h.memo.source = 'channel'
    h.memo.glPostingId = 'gl_batch'
  })

  it('refuses the void, naming the entry, its size and the way out', async () => {
    // The posting header, one summarised line, then the stamp count.
    const { db: fake } = fakeDb([postingRow()], [{ id: 'line_x' }], [{ memos: 312 }])

    await expect(
      voidCreditMemo(fake, { organizationId: ORG, userId: USER, creditMemoInstanceId: MEMO_ID })
    ).rejects.toThrow(
      'This credit memo is inside AUXX-CRM-202601, which covers 312 memos. Reverse that entry, ' +
        'void the memo, and post January 2026 again.'
    )
  })

  it('reverses nothing and leaves the memo exactly as it was', async () => {
    const { db: fake } = fakeDb([postingRow()], [{ id: 'line_x' }], [{ memos: 312 }])

    await expect(
      voidCreditMemo(fake, { organizationId: ORG, userId: USER, creditMemoInstanceId: MEMO_ID })
    ).rejects.toThrow(AuxxError)

    expect(h.reverseEntry).not.toHaveBeenCalled()
    expect(h.setValuesForEntity).not.toHaveBeenCalled()
  })

  it('carries the memo, the entry and the posting id as structured context', async () => {
    const { db: fake } = fakeDb([postingRow()], [{ id: 'line_x' }], [{ memos: 7 }])

    const error = await voidCreditMemo(fake, {
      organizationId: ORG,
      userId: USER,
      creditMemoInstanceId: MEMO_ID,
    }).catch((thrown: unknown) => thrown as AuxxError)

    expect(error).toBeInstanceOf(AuxxError)
    expect((error as AuxxError).statusCode).toBe(400)
    expect((error as AuxxError).details).toMatchObject({
      creditMemoInstanceId: MEMO_ID,
      docNumber: 'AUXX-CRM-202601',
      glPostingId: 'gl_batch',
    })
  })

  it('names a day-grouped period as itself rather than bending it into a month', async () => {
    const { db: fake } = fakeDb(
      [postingRow({ docNumber: 'AUXX-CRM-20260115', periodKey: '2026-01-15' })],
      [{ id: 'line_x' }],
      [{ memos: 4 }]
    )

    await expect(
      voidCreditMemo(fake, { organizationId: ORG, userId: USER, creditMemoInstanceId: MEMO_ID })
    ).rejects.toThrow(
      'This credit memo is inside AUXX-CRM-20260115, which covers 4 memos. Reverse that entry, ' +
        'void the memo, and post 2026-01-15 again.'
    )
  })

  it('reads an attempt-suffixed month key as that month', async () => {
    const { db: fake } = fakeDb(
      [postingRow({ docNumber: 'AUXX-CRM-202601A', periodKey: '2026-01A' })],
      [{ id: 'line_x' }],
      [{ memos: 9 }]
    )

    await expect(
      voidCreditMemo(fake, { organizationId: ORG, userId: USER, creditMemoInstanceId: MEMO_ID })
    ).rejects.toThrow('post January 2026 again.')
  })

  it('never reports zero members, because the memo being refused is one of them', async () => {
    // The count read comes back empty - an unprovisioned stamp field, say.
    const { db: fake } = fakeDb([postingRow()], [{ id: 'line_x' }], [])

    await expect(
      voidCreditMemo(fake, { organizationId: ORG, userId: USER, creditMemoInstanceId: MEMO_ID })
    ).rejects.toThrow('which covers 1 memos')
  })
})

describe('voidCreditMemo, the refusal ladder above the batch check', () => {
  beforeEach(() => {
    h.memo.status = 'issued'
    h.memo.source = 'channel'
    h.memo.glPostingId = 'gl_batch'
  })

  it('refuses a refunded memo before it ever looks at the stamp', async () => {
    h.memo.amountRefundedMinor = 50_00
    const { db: fake, select } = fakeDb([postingRow()], [{ id: 'line_x' }], [{ memos: 312 }])

    await expect(
      voidCreditMemo(fake, { organizationId: ORG, userId: USER, creditMemoInstanceId: MEMO_ID })
    ).rejects.toThrow('has been refunded and cannot be voided')

    expect(select).not.toHaveBeenCalled()
  })

  it('refuses an applied memo before it ever looks at the stamp', async () => {
    h.sumCreditMemoApplications.mockResolvedValue(25_00)
    const { db: fake, select } = fakeDb([postingRow()], [{ id: 'line_x' }], [{ memos: 312 }])

    await expect(
      voidCreditMemo(fake, { organizationId: ORG, userId: USER, creditMemoInstanceId: MEMO_ID })
    ).rejects.toThrow('Unapply this credit memo from its invoices before voiding it')

    expect(select).not.toHaveBeenCalled()
  })

  it('refuses an already-void memo before it ever looks at the stamp', async () => {
    h.memo.status = 'void'
    const { db: fake, select } = fakeDb([postingRow()], [{ id: 'line_x' }], [{ memos: 312 }])

    await expect(
      voidCreditMemo(fake, { organizationId: ORG, userId: USER, creditMemoInstanceId: MEMO_ID })
    ).rejects.toThrow('This credit memo is already void')

    expect(select).not.toHaveBeenCalled()
  })

  it('voids a channel draft with no posting and no stamp read at all', async () => {
    h.memo.status = 'draft'
    const { db: fake, select } = fakeDb([postingRow()], [{ id: 'line_x' }], [{ memos: 312 }])

    await voidCreditMemo(fake, {
      organizationId: ORG,
      userId: USER,
      creditMemoInstanceId: MEMO_ID,
    })

    expect(select).not.toHaveBeenCalled()
    expect(h.reverseEntry).not.toHaveBeenCalled()
    expect(h.setValuesForEntity).toHaveBeenCalledTimes(1)
  })
})

describe('voidCreditMemo, a posting that names the memo directly', () => {
  beforeEach(() => {
    h.memo.status = 'issued'
    h.memo.source = 'channel'
    h.memo.glPostingId = 'gl_single'
    h.listPostingsForSource.mockResolvedValue({
      isOk: () => true,
      value: [
        {
          id: 'gl_single',
          postingType: 'credit_memo',
          docNumber: 'AUXX-CRM-CM0001',
          status: 'posted',
        },
      ],
    })
  })

  it('still reverses the whole entry, unchanged', async () => {
    const { db: fake, select } = fakeDb()

    await voidCreditMemo(fake, {
      organizationId: ORG,
      userId: USER,
      creditMemoInstanceId: MEMO_ID,
    })

    expect(h.reverseEntry).toHaveBeenCalledTimes(1)
    expect(h.reverseEntry.mock.calls[0]![1]).toMatchObject({ glPostingId: 'gl_single' })
    // A line names the memo, so the batch probe is never reached.
    expect(select).not.toHaveBeenCalled()
  })

  it('flips the status to void after the reversal', async () => {
    const { db: fake } = fakeDb()

    await voidCreditMemo(fake, {
      organizationId: ORG,
      userId: USER,
      creditMemoInstanceId: MEMO_ID,
    })

    expect(h.setValuesForEntity).toHaveBeenCalledTimes(1)
    const write = h.setValuesForEntity.mock.calls[0]![0]
    expect(write.values).toContainEqual({ fieldId: 'credit_memo_status', value: 'void' })
  })

  it('refuses the void when the reversal is refused', async () => {
    h.reverseEntry.mockResolvedValue({ status: 'locked', error: 'January is closed' })
    const { db: fake } = fakeDb()

    await expect(
      voidCreditMemo(fake, { organizationId: ORG, userId: USER, creditMemoInstanceId: MEMO_ID })
    ).rejects.toThrow('could not be')
    expect(h.setValuesForEntity).not.toHaveBeenCalled()
  })
})

describe('voidCreditMemo, a stamp that is not a live batch entry', () => {
  beforeEach(() => {
    h.memo.status = 'issued'
    h.memo.source = 'channel'
    h.memo.glPostingId = 'gl_batch'
  })

  it('voids freely when the stamped posting has been reversed', async () => {
    // §4.2: a reversed stamp is not a live posting - the memo is back to
    // unposted and the batch it was in has already been rolled back.
    const { db: fake } = fakeDb([postingRow({ status: 'reversed' })])

    await voidCreditMemo(fake, {
      organizationId: ORG,
      userId: USER,
      creditMemoInstanceId: MEMO_ID,
    })

    expect(h.reverseEntry).not.toHaveBeenCalled()
    expect(h.setValuesForEntity).toHaveBeenCalledTimes(1)
  })

  it('voids freely when the stamp names a posting that no longer exists', async () => {
    const { db: fake } = fakeDb([])

    await voidCreditMemo(fake, {
      organizationId: ORG,
      userId: USER,
      creditMemoInstanceId: MEMO_ID,
    })

    expect(h.setValuesForEntity).toHaveBeenCalledTimes(1)
  })

  it('voids freely when the live posting carries no summarised line', async () => {
    // Stamped and live, but nothing on it is a `credit_memo_batch` line, so it
    // is an ordinary single-memo entry and the stamp decides nothing.
    const { db: fake } = fakeDb([postingRow()], [])

    await voidCreditMemo(fake, {
      organizationId: ORG,
      userId: USER,
      creditMemoInstanceId: MEMO_ID,
    })

    expect(h.setValuesForEntity).toHaveBeenCalledTimes(1)
  })

  it('does not read the posting at all when the memo carries no stamp', async () => {
    h.memo.glPostingId = null
    const { db: fake, select } = fakeDb([postingRow()], [{ id: 'line_x' }], [{ memos: 312 }])

    await voidCreditMemo(fake, {
      organizationId: ORG,
      userId: USER,
      creditMemoInstanceId: MEMO_ID,
    })

    expect(select).not.toHaveBeenCalled()
    expect(h.setValuesForEntity).toHaveBeenCalledTimes(1)
  })
})
