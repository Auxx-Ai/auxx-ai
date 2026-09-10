// packages/lib/src/postings/__tests__/duplicate-movements.test.ts
//
// The duplicate detector (plans/accounting/tasks/18-two-feeds-one-author.md
// §1). `listChartAccounts` is mocked, the same way `account-identities.test.ts`
// mocks it - what is under test here is the grouping and windowing over the
// posted lines, not the chart read `role-map.test.ts` already covers.
//
// The database is a hand-written stub rather than a mock chain, for
// `verify-balance.test.ts`'s reason: the module makes one grouped join, and the
// stub only needs to be awaitable once with a fixed row set - the WHERE clause
// itself (in particular `status = 'posted'`, which is what actually excludes a
// reversed original in production) is a SQL concern this file does not
// re-verify. What IS verified here is that the module's OWN grouping - by
// account, amount and direction - never puts a reversal's opposite-direction
// line in the same bucket as the entry it backs out, even if both rows
// somehow reached it.

const listChartAccounts = vi.fn()
vi.mock('../role-map', () => ({
  listChartAccounts: (...a: unknown[]) => listChartAccounts(...a),
}))

import type { Database } from '@auxx/database'
import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { findDuplicateBankMovements } from '../duplicate-movements'
import type { ChartAccountRow } from '../types'

const ORG = 'org_1'

const BANK_ACCOUNT: ChartAccountRow = {
  id: 'gl_bank_1010',
  code: '1010',
  name: 'Operating Bank',
  accountType: 'asset',
  subtype: 'bank',
  isActive: true,
}

const NON_BANK_ACCOUNT: ChartAccountRow = {
  id: 'gl_6100',
  code: '6100',
  name: 'Bank Fees',
  accountType: 'expense',
  subtype: null,
  isActive: true,
}

/** One row as the join in `duplicate-movements.ts` selects it. */
function candidateRow(overrides: {
  glPostingId: string
  docNumber: string
  txnDate: string
  glAccountId?: string
  amountMinor?: number
  direction?: 'debit' | 'credit'
  sourceType: string
}) {
  return {
    glPostingId: overrides.glPostingId,
    docNumber: overrides.docNumber,
    txnDate: overrides.txnDate,
    glAccountId: overrides.glAccountId ?? BANK_ACCOUNT.id,
    amountMinor: overrides.amountMinor ?? 548_300,
    direction: overrides.direction ?? 'debit',
    sourceType: overrides.sourceType,
  }
}

/**
 * A stub `Database` that answers whatever chain is built with one row set -
 * `verify-balance.test.ts`'s stub, copied: the module here makes one join and
 * does not care whether the caller reaches the rows via `.innerJoin()` or
 * `.orderBy()`, only that it is awaitable exactly once.
 */
function stubDb(rows: unknown[]) {
  const chain: Record<string, unknown> = {}
  const passthrough = () => chain
  for (const method of ['from', 'leftJoin', 'innerJoin', 'where', 'groupBy', 'orderBy', 'limit']) {
    chain[method] = passthrough
  }
  // biome-ignore lint/suspicious/noThenProperty: the stub must be awaitable
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(rows).then(resolve, reject)

  return { select: () => chain } as unknown as Database
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('findDuplicateBankMovements', () => {
  it('flags a payout entry and a coded bank line of the same amount, two days apart', async () => {
    listChartAccounts.mockResolvedValue(ok([BANK_ACCOUNT]))

    const result = await findDuplicateBankMovements(
      stubDb([
        candidateRow({
          glPostingId: 'gl_payout',
          docNumber: 'PAY-0004',
          txnDate: '2026-09-09',
          sourceType: 'payout',
        }),
        candidateRow({
          glPostingId: 'gl_coded',
          docNumber: 'BNK-0112',
          txnDate: '2026-09-11',
          sourceType: 'bank_transaction',
        }),
      ]),
      { organizationId: ORG }
    )

    const findings = result._unsafeUnwrap()
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      glAccountId: BANK_ACCOUNT.id,
      accountCode: '1010',
      accountName: 'Operating Bank',
      amountMinor: 548_300,
      direction: 'debit',
    })
    expect(findings[0]?.entries.map((entry) => entry.docNumber)).toEqual(['PAY-0004', 'BNK-0112'])
  })

  it('finds nothing once the line was matched instead of coded, so no second posting exists', async () => {
    // `matchTransaction` (B5) links a bank line to a document and posts
    // nothing, so the payout is the only line the query would ever see.
    listChartAccounts.mockResolvedValue(ok([BANK_ACCOUNT]))

    const result = await findDuplicateBankMovements(
      stubDb([
        candidateRow({
          glPostingId: 'gl_payout',
          docNumber: 'PAY-0004',
          txnDate: '2026-09-09',
          sourceType: 'payout',
        }),
      ]),
      { organizationId: ORG }
    )

    expect(result._unsafeUnwrap()).toEqual([])
  })

  it('does not flag two same-amount same-day deposits from one source', async () => {
    // The `sourceType` guard: two ordinary deposits from the same connector
    // are not a duplicate, they are two events that happen to be the same size.
    listChartAccounts.mockResolvedValue(ok([BANK_ACCOUNT]))

    const result = await findDuplicateBankMovements(
      stubDb([
        candidateRow({
          glPostingId: 'gl_dep_1',
          docNumber: 'DEP-0007',
          txnDate: '2026-09-10',
          sourceType: 'bank_deposit',
        }),
        candidateRow({
          glPostingId: 'gl_dep_2',
          docNumber: 'DEP-0008',
          txnDate: '2026-09-10',
          sourceType: 'bank_deposit',
        }),
      ]),
      { organizationId: ORG }
    )

    expect(result._unsafeUnwrap()).toEqual([])
  })

  it('does not cross-flag a reversal and the entry it backs out', async () => {
    // A reversal flips `direction` (decision G4), so even if both rows reached
    // this module - production's `status = 'posted'` filter should already
    // have excluded the reversed original - grouping by direction keeps them
    // in separate buckets.
    listChartAccounts.mockResolvedValue(ok([BANK_ACCOUNT]))

    const result = await findDuplicateBankMovements(
      stubDb([
        candidateRow({
          glPostingId: 'gl_orig',
          docNumber: 'PAY-0005',
          txnDate: '2026-09-09',
          direction: 'debit',
          sourceType: 'payout',
        }),
        candidateRow({
          glPostingId: 'gl_rev',
          docNumber: 'PAY-0005-R1',
          txnDate: '2026-09-09',
          direction: 'credit',
          sourceType: 'payout',
        }),
      ]),
      { organizationId: ORG }
    )

    expect(result._unsafeUnwrap()).toEqual([])
  })

  it('never flags lines on a non-bank account, even with a matching amount and two sources', async () => {
    // The real query filters to `glAccountId IN (<bank account ids>)`, so a
    // non-bank account's lines never reach the row set at all. This proves the
    // module's OWN guard as a second line of defence: an id that is not in the
    // bank-account map it built from the chart is silently skipped rather than
    // flagged, even when the rows LOOK like a duplicate on their own.
    listChartAccounts.mockResolvedValue(ok([BANK_ACCOUNT]))

    const result = await findDuplicateBankMovements(
      stubDb([
        candidateRow({
          glPostingId: 'gl_a',
          docNumber: 'JNL-0001',
          txnDate: '2026-09-09',
          glAccountId: NON_BANK_ACCOUNT.id,
          sourceType: 'vendor_bill',
        }),
        candidateRow({
          glPostingId: 'gl_b',
          docNumber: 'JNL-0002',
          txnDate: '2026-09-10',
          glAccountId: NON_BANK_ACCOUNT.id,
          sourceType: 'manual_journal',
        }),
      ]),
      { organizationId: ORG }
    )

    expect(result._unsafeUnwrap()).toEqual([])
  })

  it('returns ok([]) without querying when the chart has no bank-typed account', async () => {
    listChartAccounts.mockResolvedValue(ok([NON_BANK_ACCOUNT]))

    const db = { select: vi.fn() } as unknown as Database
    const result = await findDuplicateBankMovements(db, { organizationId: ORG })

    expect(result._unsafeUnwrap()).toEqual([])
    expect(db.select).not.toHaveBeenCalled()
  })

  it('returns err rather than throwing when the chart read fails', async () => {
    listChartAccounts.mockResolvedValue(err(new Error('chart read broke')))

    const result = await findDuplicateBankMovements(stubDb([]), { organizationId: ORG })
    expect(result.isErr()).toBe(true)
  })

  it('returns err rather than throwing when the ledger read fails', async () => {
    listChartAccounts.mockResolvedValue(ok([BANK_ACCOUNT]))
    const throwingDb = {
      select: () => {
        throw new Error('connection reset')
      },
    } as unknown as Database

    const result = await findDuplicateBankMovements(throwingDb, { organizationId: ORG })
    expect(result.isErr()).toBe(true)
  })

  it('refuses a malformed month rather than silently matching nothing', async () => {
    listChartAccounts.mockResolvedValue(ok([BANK_ACCOUNT]))

    const result = await findDuplicateBankMovements(stubDb([]), {
      organizationId: ORG,
      month: 'not-a-month',
    })
    expect(result.isErr()).toBe(true)
  })
})
