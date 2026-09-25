// packages/lib/src/accounting/sales/credit-memos/__tests__/repost.test.ts
//
// 91 §4.8: a memo posted, then its fulfillment cancelled. The memo re-reads its lines and
// is reversed and re-posted at the next generation, so it nets with the shipment reversal.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  loadCreditMemo: vi.fn(),
  loadCreditMemoLines: vi.fn(),
  readShippedMemoLineIds: vi.fn(),
  listCreditMemoIdsForOrder: vi.fn(),
  readEditStamp: vi.fn(),
  findLiveSubjectPosting: vi.fn(),
  readDocumentLedgerState: vi.fn(),
  writeDocumentLedgerGeneration: vi.fn(),
  readBuiltEntry: vi.fn(),
  entryLinesEqual: vi.fn(),
  buildEntryForCreditMemo: vi.fn(),
  postCreditMemoEntry: vi.fn(),
  reverseEntry: vi.fn(),
  readFulfillmentPostingSubject: vi.fn(),
  order: [] as string[],
}))

vi.mock('@auxx/database', () => ({ withAccountingCommitLock: vi.fn() }))
vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}))
vi.mock('../../../../entity-instances/edit-snapshot', () => ({ readEditStamp: h.readEditStamp }))
vi.mock('../../../documents/document-ledger-state', () => ({
  readDocumentLedgerState: h.readDocumentLedgerState,
  writeDocumentLedgerGeneration: h.writeDocumentLedgerGeneration,
}))
vi.mock('../../../documents/edit-in-place/save', () => ({
  readBuiltEntry: h.readBuiltEntry,
  entryLinesEqual: h.entryLinesEqual,
}))
vi.mock('../../../ledger/post/reverse-entry', () => ({ reverseEntry: h.reverseEntry }))
vi.mock('../../../ledger/reads/list-postings', () => ({
  findLiveSubjectPosting: h.findLiveSubjectPosting,
}))
vi.mock('../../fulfillments/reads', () => ({
  readFulfillmentPostingSubject: h.readFulfillmentPostingSubject,
}))
vi.mock('../accounting', () => ({
  buildEntryForCreditMemo: h.buildEntryForCreditMemo,
  organizationCurrency: async () => 'USD',
  postCreditMemoEntry: h.postCreditMemoEntry,
}))
vi.mock('../reads', () => ({
  listCreditMemoIdsForOrder: h.listCreditMemoIdsForOrder,
  loadCreditMemo: h.loadCreditMemo,
  loadCreditMemoLines: h.loadCreditMemoLines,
  readShippedMemoLineIds: h.readShippedMemoLineIds,
}))

import type { Database } from '@auxx/database'
import { repostCreditMemoEntry, repostCreditMemosForCancelledFulfillment } from '../repost'

const ORG = 'org_1'
const db = { transaction: async (fn: (tx: unknown) => unknown) => fn({}) } as unknown as Database
const MEMO = {
  id: 'cm_1',
  number: 'CM-0001',
  status: 'settled',
  issuedAt: '2026-09-10',
  lineIds: ['l1'],
  contactInstanceId: 'contact_1',
  orderInstanceId: 'order_1',
  source: 'channel',
}
const rebuilt = { entry: { txnDate: '2026-09-10', lines: [] } }

beforeEach(() => {
  vi.clearAllMocks()
  h.order = []
  h.loadCreditMemo.mockResolvedValue(MEMO)
  h.loadCreditMemoLines.mockResolvedValue([{ id: 'l1' }])
  h.readShippedMemoLineIds.mockResolvedValue(new Set())
  h.readEditStamp.mockResolvedValue(null)
  h.findLiveSubjectPosting.mockResolvedValue({
    isErr: () => false,
    value: { id: 'gp_1', docNumber: 'CRM-CM-0001' },
  })
  h.readDocumentLedgerState.mockResolvedValue({ generation: 1 })
  h.readBuiltEntry.mockResolvedValue({ txnDate: '2026-09-10', lines: [] })
  h.entryLinesEqual.mockReturnValue(false)
  h.buildEntryForCreditMemo.mockReturnValue(null)
  h.reverseEntry.mockImplementation(async () => {
    h.order.push('reverse')
    return { status: 'posted' }
  })
  h.postCreditMemoEntry.mockImplementation(async () => {
    h.order.push('post')
    return { status: 'posted' }
  })
})

describe('repostCreditMemoEntry', () => {
  it('reverses a memo whose lines no longer shipped, posting nothing in its place', async () => {
    expect(
      await repostCreditMemoEntry(db, { organizationId: ORG, creditMemoInstanceId: 'cm_1' })
    ).toBe('reversed')
    expect(h.reverseEntry).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ glPostingId: 'gp_1' })
    )
    expect(h.postCreditMemoEntry).not.toHaveBeenCalled()
    expect(h.writeDocumentLedgerGeneration).toHaveBeenCalledWith(expect.anything(), ORG, 'cm_1', 2)
  })

  it('reverses then re-posts at the next generation when some lines still shipped', async () => {
    h.readShippedMemoLineIds.mockResolvedValue(new Set(['l1']))
    h.buildEntryForCreditMemo.mockReturnValue(rebuilt)

    expect(
      await repostCreditMemoEntry(db, { organizationId: ORG, creditMemoInstanceId: 'cm_1' })
    ).toBe('reposted')
    expect(h.buildEntryForCreditMemo).toHaveBeenCalledWith(
      expect.objectContaining({ generation: 2, shippedLineIds: new Set(['l1']) })
    )
    expect(h.order).toEqual(['reverse', 'post'])
  })

  it('leaves a memo alone when the rebuild equals what stands', async () => {
    h.buildEntryForCreditMemo.mockReturnValue(rebuilt)
    h.entryLinesEqual.mockReturnValue(true)

    expect(
      await repostCreditMemoEntry(db, { organizationId: ORG, creditMemoInstanceId: 'cm_1' })
    ).toBe('unchanged')
    expect(h.reverseEntry).not.toHaveBeenCalled()
  })

  it('does nothing for a memo with no live entry, or one open for editing', async () => {
    h.findLiveSubjectPosting.mockResolvedValueOnce({ isErr: () => false, value: null })
    expect(
      await repostCreditMemoEntry(db, { organizationId: ORG, creditMemoInstanceId: 'cm_1' })
    ).toBeNull()
    h.readEditStamp.mockResolvedValueOnce({ openedAt: 'now' })
    expect(
      await repostCreditMemoEntry(db, { organizationId: ORG, creditMemoInstanceId: 'cm_1' })
    ).toBeNull()
    expect(h.reverseEntry).not.toHaveBeenCalled()
  })

  it('throws and records no generation when the ledger refuses the reversal', async () => {
    h.reverseEntry.mockResolvedValue({ status: 'period_locked', error: 'locked' })
    await expect(
      repostCreditMemoEntry(db, { organizationId: ORG, creditMemoInstanceId: 'cm_1' })
    ).rejects.toThrow(/could not be reversed/)
    expect(h.writeDocumentLedgerGeneration).not.toHaveBeenCalled()
  })
})

describe('repostCreditMemosForCancelledFulfillment', () => {
  it('re-posts every memo on the fulfillment order and survives one that fails', async () => {
    h.readFulfillmentPostingSubject.mockResolvedValue({ orderId: 'order_1', subtotalMinor: 100 })
    h.listCreditMemoIdsForOrder.mockResolvedValue(['cm_1', 'cm_2'])
    h.reverseEntry.mockResolvedValueOnce({ status: 'period_locked', error: 'locked' })

    await repostCreditMemosForCancelledFulfillment(db, {
      organizationId: ORG,
      fulfillmentInstanceId: 'ff_1',
    })

    expect(h.listCreditMemoIdsForOrder).toHaveBeenCalledWith(db, ORG, 'order_1')
    expect(h.loadCreditMemo).toHaveBeenCalledTimes(2)
  })
})
