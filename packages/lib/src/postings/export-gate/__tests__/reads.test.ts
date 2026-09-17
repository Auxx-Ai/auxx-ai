// packages/lib/src/postings/export-gate/__tests__/reads.test.ts
//
// What the gate ATTACHES to which posting, and what it refuses to answer.
//
// Every collaborator is mocked because none of them is under test here - the
// three subledger counts, the balance sweep and the bank review queue all have
// their own suites. What this file proves is the wiring: that a finding lands on
// the posting that claims it and on no other, that a check which could not run
// is REPORTED rather than silently passed, and that the gate fails open.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  listFailedExports: vi.fn(),
  verifyBooksBalance: vi.fn(),
  countUnissuedChannelCreditMemos: vi.fn(),
  listBankAccounts: vi.fn(),
  readQueueStats: vi.fn(),
}))

vi.mock('../../verify-balance', () => ({
  listFailedExports: h.listFailedExports,
  verifyBooksBalance: h.verifyBooksBalance,
}))
vi.mock('../../../money/credit-memos/reads', () => ({
  countUnissuedChannelCreditMemos: h.countUnissuedChannelCreditMemos,
}))
vi.mock('../../../banking/reads', () => ({ listBankAccounts: h.listBankAccounts }))
vi.mock('../../../banking/review/reads', () => ({ readQueueStats: h.readQueueStats }))

import type { Database } from '@auxx/database'
import { err, ok } from 'neverthrow'
import { AuxxError } from '../../../errors'
import type { PostingType, SyncQueueRow } from '../../types'
import { evaluateExportGate } from '../reads'

const ORG = 'org_1'

function queueRow(overrides: Partial<SyncQueueRow> & { glPostingId: string }): SyncQueueRow {
  return {
    periodKey: '2026-08',
    postingType: 'fulfillment' as PostingType,
    exportStatus: 'pending',
    docNumber: `DOC-${overrides.glPostingId}`,
    attempts: 0,
    failureReason: null,
    txnDate: '2026-08-31',
    totalMinor: 10_000,
    currency: 'USD',
    deliveryIntent: 'manual',
    releasedAt: null,
    deliveryState: null,
    ...overrides,
  }
}

/** A stub that answers the ONE query this module makes with the given rows. */
function stubDb(lineRows: { glPostingId: string; glAccountId: string }[] = []): Database {
  const chain: Record<string, unknown> = {}
  for (const method of ['from', 'where']) chain[method] = () => chain
  // biome-ignore lint/suspicious/noThenProperty: the stub must be awaitable
  chain.then = (resolve: (v: unknown) => unknown) => resolve(lineRows)
  return { selectDistinct: () => chain } as unknown as Database
}

beforeEach(() => {
  vi.clearAllMocks()
  h.listFailedExports.mockResolvedValue(ok([]))
  h.verifyBooksBalance.mockResolvedValue(
    ok({ balanced: true, postingsChecked: 0, discrepancies: [] })
  )
  h.countUnissuedChannelCreditMemos.mockResolvedValue(0)
  h.listBankAccounts.mockResolvedValue(ok([]))
  h.readQueueStats.mockResolvedValue(
    ok({
      forReviewCount: 0,
      unreviewedCount: 0,
      oldestUnreviewedDate: null,
      unreviewedInMinor: 0,
      unreviewedOutMinor: 0,
      coverageFrom: null,
      coverageGapCount: 0,
    })
  )
})

describe('the candidate set', () => {
  it('is the sync queue itself, so the gate and the queue cannot disagree', async () => {
    h.listFailedExports.mockResolvedValue(ok([queueRow({ glPostingId: 'p1' })]))

    const result = await evaluateExportGate(stubDb(), ORG, { through: '2026-08' })

    expect(h.listFailedExports).toHaveBeenCalledWith(expect.anything(), ORG, { through: '2026-08' })
    expect(result._unsafeUnwrap().postingsChecked).toBe(1)
  })

  it('narrows to the ids asked for, and says nothing about an id that is not in the queue', async () => {
    h.listFailedExports.mockResolvedValue(
      ok([queueRow({ glPostingId: 'p1' }), queueRow({ glPostingId: 'p2' })])
    )

    const report = (
      await evaluateExportGate(stubDb(), ORG, { glPostingIds: ['p2', 'already_exported'] })
    )._unsafeUnwrap()

    expect(report.verdicts.map((verdict) => verdict.glPostingId)).toEqual(['p2'])
  })

  it('reports nothing rather than erroring when there is nothing to judge', async () => {
    const report = (await evaluateExportGate(stubDb(), ORG))._unsafeUnwrap()
    expect(report).toMatchObject({ postingsChecked: 0, blocked: 0, warned: 0, unavailable: [] })
    // 🛑 And it does NOT go on to ask three subledgers about a queue of nothing.
    expect(h.verifyBooksBalance).not.toHaveBeenCalled()
  })

  it('surfaces a refused queue read as an error of its own', async () => {
    h.listFailedExports.mockResolvedValue(err(new AuxxError('bad through')))
    const result = await evaluateExportGate(stubDb(), ORG, { through: 'nonsense' })
    expect(result.isErr()).toBe(true)
  })
})

describe('the source completeness check', () => {
  // 🛑 A fulfillment posting's only claimed stream, `unposted_shipments`, is
  // pinned at 0 now that shipments post eagerly (step 1b, TARGET §1) - there is
  // no batch/effect backlog left for this check to find. So a fulfillment
  // summary can never block on `source_completeness` any more; only a credit
  // memo's `draft_channel_memos` stream still can.

  it('leaves a manual journal in the same month alone', async () => {
    // 🔑 The whole reason `CLAIMED_SOURCE_STREAMS` exists. A journal somebody
    // wrote by hand asserts nothing about how complete the month's revenue is,
    // and blocking it would teach an operator to route around the gate.
    h.listFailedExports.mockResolvedValue(
      ok([queueRow({ glPostingId: 'p1', postingType: 'manual_journal' })])
    )

    const report = (await evaluateExportGate(stubDb(), ORG))._unsafeUnwrap()

    expect(report.verdicts[0]?.status).toBe('clear')
    expect(report.verdicts[0]?.message).toBe(null)
    // The subledger is never even asked about a month nothing claims.
    expect(h.countUnissuedChannelCreditMemos).not.toHaveBeenCalled()
  })

  it('blocks a credit memo entry whose month still holds a draft channel memo', async () => {
    h.listFailedExports.mockResolvedValue(
      ok([queueRow({ glPostingId: 'p1', postingType: 'credit_memo' })])
    )
    h.countUnissuedChannelCreditMemos.mockResolvedValue(1)

    const report = (await evaluateExportGate(stubDb(), ORG))._unsafeUnwrap()

    expect(report.verdicts[0]?.status).toBe('block')
    expect(report.verdicts[0]?.findings.map((finding) => finding.key)).toEqual([
      'draft_channel_memos',
    ])
  })

  it('counts a month once however many postings sit in it, and folds a day key into its month', async () => {
    h.listFailedExports.mockResolvedValue(
      ok([
        queueRow({ glPostingId: 'p1', postingType: 'credit_memo', periodKey: '2026-08-18' }),
        queueRow({ glPostingId: 'p2', postingType: 'credit_memo', periodKey: '2026-08-19' }),
        queueRow({ glPostingId: 'p3', postingType: 'credit_memo', periodKey: '2026-08' }),
      ])
    )

    await evaluateExportGate(stubDb(), ORG)

    expect(h.countUnissuedChannelCreditMemos).toHaveBeenCalledTimes(1)
    expect(h.countUnissuedChannelCreditMemos).toHaveBeenCalledWith(expect.anything(), {
      organizationId: ORG,
      month: '2026-08',
    })
  })

  it('does not place a payout-keyed posting in a month it cannot be in', async () => {
    h.listFailedExports.mockResolvedValue(
      ok([queueRow({ glPostingId: 'p1', postingType: 'payout', periodKey: 'po_abc123' })])
    )

    const report = (await evaluateExportGate(stubDb(), ORG))._unsafeUnwrap()

    expect(report.verdicts[0]?.status).toBe('clear')
    expect(h.countUnissuedChannelCreditMemos).not.toHaveBeenCalled()
  })

  it('declares the check unavailable rather than reporting a month with a hole in it', async () => {
    h.listFailedExports.mockResolvedValue(
      ok([queueRow({ glPostingId: 'p1', postingType: 'credit_memo' })])
    )
    h.countUnissuedChannelCreditMemos.mockRejectedValue(new Error('field cache down'))

    const report = (await evaluateExportGate(stubDb(), ORG))._unsafeUnwrap()

    expect(report.unavailable).toContain('source_completeness')
    // 🛑 Fails OPEN rather than blocking on a partial answer.
    expect(report.verdicts[0]?.status).toBe('clear')
  })
})

describe('the entry balance check', () => {
  it('blocks an entry that does not tie, whatever kind it is', async () => {
    h.listFailedExports.mockResolvedValue(
      ok([queueRow({ glPostingId: 'p1', postingType: 'manual_journal' })])
    )
    h.verifyBooksBalance.mockResolvedValue(
      ok({
        balanced: false,
        postingsChecked: 1,
        discrepancies: [
          {
            glPostingId: 'p1',
            docNumber: 'DOC-p1',
            postingType: 'manual_journal',
            periodKey: '2026-08',
            totalDebitMinor: 100,
            totalCreditMinor: 90,
            recordedTotalMinor: 100,
          },
        ],
      })
    )

    const report = (await evaluateExportGate(stubDb(), ORG))._unsafeUnwrap()

    expect(report.verdicts[0]?.status).toBe('block')
    expect(report.verdicts[0]?.message).toContain('DOC-p1 was not sent: the entry itself is wrong.')
    expect(report.verdicts[0]?.message).toContain('DOC-p1 does not tie')
  })

  it('calls a posted header with no lines what it is', async () => {
    h.listFailedExports.mockResolvedValue(ok([queueRow({ glPostingId: 'p1' })]))
    h.verifyBooksBalance.mockResolvedValue(
      ok({
        balanced: false,
        postingsChecked: 1,
        discrepancies: [
          {
            glPostingId: 'p1',
            docNumber: 'DOC-p1',
            postingType: 'fulfillment',
            periodKey: '2026-08',
            totalDebitMinor: 0,
            totalCreditMinor: 0,
            recordedTotalMinor: 10_000,
          },
        ],
      })
    )

    const report = (await evaluateExportGate(stubDb(), ORG))._unsafeUnwrap()
    expect(report.verdicts[0]?.message).toContain('posted header with no lines')
  })

  it('names the check unavailable and blocks nothing when the sweep fails', async () => {
    h.listFailedExports.mockResolvedValue(ok([queueRow({ glPostingId: 'p1' })]))
    h.verifyBooksBalance.mockResolvedValue(err(new AuxxError('Internal error')))

    const report = (await evaluateExportGate(stubDb(), ORG))._unsafeUnwrap()

    expect(report.unavailable).toContain('entry_balance')
    expect(report.blocked).toBe(0)
  })
})

describe('the bank reconciliation check', () => {
  const ACCOUNT = { id: 'ba_1', name: 'Chase 1234', glAccountId: 'gl_cash' }

  it('warns, never blocks, when a touched account has unreviewed lines', async () => {
    h.listFailedExports.mockResolvedValue(
      ok([queueRow({ glPostingId: 'p1', postingType: 'payout', periodKey: 'po_1' })])
    )
    h.listBankAccounts.mockResolvedValue(ok([ACCOUNT]))
    h.readQueueStats.mockResolvedValue(
      ok({
        forReviewCount: 3,
        unreviewedCount: 3,
        oldestUnreviewedDate: '2026-03-02',
        unreviewedInMinor: 0,
        unreviewedOutMinor: 0,
        coverageFrom: null,
        coverageGapCount: 2,
      })
    )

    const report = (
      await evaluateExportGate(stubDb([{ glPostingId: 'p1', glAccountId: 'gl_cash' }]), ORG)
    )._unsafeUnwrap()

    expect(report.verdicts[0]?.status).toBe('warn')
    expect(report.warned).toBe(1)
    expect(report.blocked).toBe(0)
    expect(report.verdicts[0]?.findings.map((finding) => finding.key)).toEqual([
      'bank_unreviewed',
      'bank_coverage_gap',
    ])
    expect(report.verdicts[0]?.message).toContain('can be sent, but not everything behind it')
  })

  it('says nothing about a posting that touches no bank-backed account', async () => {
    h.listFailedExports.mockResolvedValue(ok([queueRow({ glPostingId: 'p1' })]))
    h.listBankAccounts.mockResolvedValue(ok([ACCOUNT]))
    h.readQueueStats.mockResolvedValue(
      ok({
        forReviewCount: 9,
        unreviewedCount: 9,
        oldestUnreviewedDate: '2026-03-02',
        unreviewedInMinor: 0,
        unreviewedOutMinor: 0,
        coverageFrom: null,
        coverageGapCount: 0,
      })
    )

    // No line of p1 hits `gl_cash`.
    const report = (await evaluateExportGate(stubDb([]), ORG))._unsafeUnwrap()

    expect(report.verdicts[0]?.status).toBe('clear')
    expect(h.readQueueStats).not.toHaveBeenCalled()
  })

  it('treats an org with no mapped bank account as UNANSWERED, not as reconciled', async () => {
    // ⚠️ The one that matters. An org that has never run the bank_account entity
    // migration reads as empty rather than erroring, and reporting that as a
    // clean bank is the exact shape of a green gate that checked nothing.
    h.listFailedExports.mockResolvedValue(ok([queueRow({ glPostingId: 'p1' })]))
    h.listBankAccounts.mockResolvedValue(ok([]))

    const report = (await evaluateExportGate(stubDb(), ORG))._unsafeUnwrap()

    expect(report.unavailable).toContain('bank_reconciliation')
  })

  it('asks one account once even when several postings touch it', async () => {
    h.listFailedExports.mockResolvedValue(
      ok([
        queueRow({ glPostingId: 'p1', postingType: 'payout', periodKey: 'po_1' }),
        queueRow({ glPostingId: 'p2', postingType: 'payout', periodKey: 'po_2' }),
      ])
    )
    h.listBankAccounts.mockResolvedValue(ok([ACCOUNT]))

    await evaluateExportGate(
      stubDb([
        { glPostingId: 'p1', glAccountId: 'gl_cash' },
        { glPostingId: 'p2', glAccountId: 'gl_cash' },
      ]),
      ORG
    )

    expect(h.readQueueStats).toHaveBeenCalledTimes(1)
  })
})
