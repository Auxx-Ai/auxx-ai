// packages/lib/src/banking/rules/__tests__/suggest.test.ts
//
// suggestFromHistory with doubles: `reads.ts`'s three query functions are
// mocked so this file tests the PRODUCER LOGIC (transfer-first, then
// majority-code-from-history) without a database.

import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TransactionMatchRow } from '../reads'
import * as reads from '../reads'
import { suggestFromHistory } from '../suggest'

vi.mock('../reads', () => ({
  getTransactionMatchRow: vi.fn(),
  findTransferCandidate: vi.fn(),
  listHistoryMatches: vi.fn(),
}))

const db = {} as never

function baseRow(overrides: Partial<TransactionMatchRow> = {}): TransactionMatchRow {
  return {
    id: 'txn_1',
    bankAccountId: 'acct_1',
    postedAt: '2026-08-15',
    description: 'MONTHLY SVC FEE',
    matchKey: 'MONTHLY SVC FEE',
    amountMinor: -1500,
    reviewStatus: 'for_review',
    glAccountCode: null,
    ...overrides,
  }
}

describe('suggestFromHistory', () => {
  beforeEach(() => {
    vi.mocked(reads.getTransactionMatchRow).mockReset()
    vi.mocked(reads.findTransferCandidate).mockReset()
    vi.mocked(reads.listHistoryMatches).mockReset()
  })

  it('errors when the transaction does not exist', async () => {
    vi.mocked(reads.getTransactionMatchRow).mockResolvedValue(ok(null))
    const result = await suggestFromHistory(db, {
      organizationId: 'org_1',
      transactionId: 'missing',
    })
    expect(result.isErr()).toBe(true)
  })

  it('propagates a read error', async () => {
    vi.mocked(reads.getTransactionMatchRow).mockResolvedValue(err(new Error('boom')))
    const result = await suggestFromHistory(db, { organizationId: 'org_1', transactionId: 'txn_1' })
    expect(result.isErr()).toBe(true)
  })

  it('suggests a transfer when an opposite-sign match exists, before checking history', async () => {
    vi.mocked(reads.getTransactionMatchRow).mockResolvedValue(ok(baseRow()))
    vi.mocked(reads.findTransferCandidate).mockResolvedValue(
      ok({ id: 'txn_2', bankAccountId: 'acct_2' })
    )
    // listHistoryMatches should never even be called once a transfer is found.
    vi.mocked(reads.listHistoryMatches).mockResolvedValue(ok([]))

    const result = await suggestFromHistory(db, { organizationId: 'org_1', transactionId: 'txn_1' })
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toEqual({
      source: 'transfer',
      glAccountCode: null,
      recordId: 'acct_2',
      recordType: 'bank_account',
      reason: expect.stringContaining('opposite-sign'),
      ruleId: null,
    })
    expect(reads.listHistoryMatches).not.toHaveBeenCalled()
  })

  it('returns null when neither a transfer nor a history majority is found', async () => {
    vi.mocked(reads.getTransactionMatchRow).mockResolvedValue(ok(baseRow()))
    vi.mocked(reads.findTransferCandidate).mockResolvedValue(ok(null))
    vi.mocked(reads.listHistoryMatches).mockResolvedValue(ok([]))

    const result = await suggestFromHistory(db, { organizationId: 'org_1', transactionId: 'txn_1' })
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toBeNull()
  })

  it('returns null when there is only one historical match - one is a coincidence', async () => {
    vi.mocked(reads.getTransactionMatchRow).mockResolvedValue(ok(baseRow()))
    vi.mocked(reads.findTransferCandidate).mockResolvedValue(ok(null))
    vi.mocked(reads.listHistoryMatches).mockResolvedValue(
      ok([{ glAccountCode: '6100', postedAt: '2026-08-01' }])
    )

    const result = await suggestFromHistory(db, { organizationId: 'org_1', transactionId: 'txn_1' })
    expect(result._unsafeUnwrap()).toBeNull()
  })

  it('suggests the majority code and names the count in the reason', async () => {
    vi.mocked(reads.getTransactionMatchRow).mockResolvedValue(ok(baseRow()))
    vi.mocked(reads.findTransferCandidate).mockResolvedValue(ok(null))
    vi.mocked(reads.listHistoryMatches).mockResolvedValue(
      ok([
        { glAccountCode: '6100', postedAt: '2026-08-01' },
        { glAccountCode: '6100', postedAt: '2026-07-01' },
        { glAccountCode: '6100', postedAt: '2026-06-01' },
        { glAccountCode: '6200', postedAt: '2026-05-01' },
      ])
    )

    const result = await suggestFromHistory(db, { organizationId: 'org_1', transactionId: 'txn_1' })
    expect(result._unsafeUnwrap()).toEqual({
      source: 'history',
      glAccountCode: '6100',
      recordId: null,
      recordType: null,
      reason: 'The last 3 lines matching this key were coded to 6100.',
      ruleId: null,
    })
  })

  it('ignores a matched line that carries no code when computing the majority', async () => {
    vi.mocked(reads.getTransactionMatchRow).mockResolvedValue(ok(baseRow()))
    vi.mocked(reads.findTransferCandidate).mockResolvedValue(ok(null))
    vi.mocked(reads.listHistoryMatches).mockResolvedValue(
      ok([
        { glAccountCode: null, postedAt: '2026-08-10' },
        { glAccountCode: '6100', postedAt: '2026-08-01' },
        { glAccountCode: '6100', postedAt: '2026-07-01' },
      ])
    )

    const result = await suggestFromHistory(db, { organizationId: 'org_1', transactionId: 'txn_1' })
    expect(result._unsafeUnwrap()?.glAccountCode).toBe('6100')
    expect(result._unsafeUnwrap()?.reason).toContain('2 lines')
  })

  it('returns null without querying history when the line has no matchKey', async () => {
    vi.mocked(reads.getTransactionMatchRow).mockResolvedValue(ok(baseRow({ matchKey: null })))
    vi.mocked(reads.findTransferCandidate).mockResolvedValue(ok(null))

    const result = await suggestFromHistory(db, { organizationId: 'org_1', transactionId: 'txn_1' })
    expect(result._unsafeUnwrap()).toBeNull()
    expect(reads.listHistoryMatches).not.toHaveBeenCalled()
  })
})
