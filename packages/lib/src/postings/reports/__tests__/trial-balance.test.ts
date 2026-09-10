// packages/lib/src/postings/reports/__tests__/trial-balance.test.ts
//
// `readTrialBalance` composes two collaborators this file mocks rather than
// re-tests: `listChartAccounts` (its own decode is covered by
// `role-map.test.ts` / `chart-accounts.test.ts`) and the grouped SQL query,
// stubbed the same way `verify-balance.test.ts` stubs its own grouped read -
// a hand-written thenable chain, because the interesting cases are about the
// SHAPE of the rows Postgres hands back (a string aggregate), which a generic
// chainable spy cannot express.

import type { Database } from '@auxx/database'
import { err, ok } from 'neverthrow'
import { describe, expect, it, vi } from 'vitest'
import type { ChartAccountRow } from '../../types'

vi.mock('../../role-map', () => ({ listChartAccounts: vi.fn() }))

import { listChartAccounts } from '../../role-map'
import { readTrialBalance } from '../trial-balance'

const ORG = 'org_1'

function stubDb(rows: unknown[]) {
  const chain: Record<string, unknown> = {}
  const passthrough = () => chain
  for (const method of ['from', 'innerJoin', 'where', 'groupBy', 'orderBy']) {
    chain[method] = passthrough
  }
  // biome-ignore lint/suspicious/noThenProperty: the stub must be awaitable
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(rows).then(resolve, reject)
  return { select: () => chain } as unknown as Database
}

/** `glAccountId` defaults to `id_<accountCode>`, matching the `account()` helper below. */
function groupedRow(
  accountCode: string,
  debit: number,
  credit: number,
  glAccountId = `id_${accountCode}`
) {
  return { glAccountId, accountCode, debitMinor: String(debit), creditMinor: String(credit) }
}

function account(overrides: Partial<ChartAccountRow> & { code: string | null }): ChartAccountRow {
  return {
    id: `id_${overrides.code}`,
    name: '',
    accountType: 'asset',
    isActive: true,
    subtype: null,
    ...overrides,
  }
}

describe('readTrialBalance', () => {
  it('signs each row by its account type, and totals both sides', async () => {
    vi.mocked(listChartAccounts).mockResolvedValue(
      ok([
        account({ code: '1000', name: 'Cash', accountType: 'asset' }),
        account({ code: '2000', name: 'Accounts Payable', accountType: 'liability' }),
      ])
    )

    const result = await readTrialBalance(
      stubDb([groupedRow('1000', 125_000, 0), groupedRow('2000', 0, 125_000)]),
      { organizationId: ORG, to: '2026-08-31' }
    )

    const tb = result._unsafeUnwrap()
    expect(tb.rows).toEqual([
      {
        glAccountId: 'id_1000',
        accountCode: '1000',
        accountName: 'Cash',
        accountType: 'asset',
        subtype: null,
        debitMinor: 125_000,
        creditMinor: 0,
        balanceMinor: 125_000,
        inChart: true,
      },
      {
        glAccountId: 'id_2000',
        accountCode: '2000',
        accountName: 'Accounts Payable',
        accountType: 'liability',
        subtype: null,
        debitMinor: 0,
        creditMinor: 125_000,
        balanceMinor: 125_000,
        inChart: true,
      },
    ])
    expect(tb.totalDebitMinor).toBe(125_000)
    expect(tb.totalCreditMinor).toBe(125_000)
    expect(tb.balanced).toBe(true)
  })

  it('ties to a balanced ledger the way verifyBooksBalance would - equal debit and credit totals', async () => {
    vi.mocked(listChartAccounts).mockResolvedValue(
      ok([
        account({ code: '1000', accountType: 'asset' }),
        account({ code: '4000', accountType: 'revenue' }),
      ])
    )

    const result = await readTrialBalance(
      stubDb([groupedRow('1000', 50_000, 0), groupedRow('4000', 0, 50_000)]),
      { organizationId: ORG, to: '2026-08-31' }
    )

    expect(result._unsafeUnwrap().balanced).toBe(true)
  })

  it('flags an id with posted lines but no live chart row (the account was deleted)', async () => {
    vi.mocked(listChartAccounts).mockResolvedValue(ok([]))

    const result = await readTrialBalance(stubDb([groupedRow('9999', 100, 0)]), {
      organizationId: ORG,
      to: '2026-08-31',
    })

    const row = result._unsafeUnwrap().rows[0]
    expect(row).toMatchObject({
      glAccountId: 'id_9999',
      // Falls back to the line's own snapshot code - the only identifying
      // label left once the account is gone from the chart.
      accountCode: '9999',
      accountType: null,
      inChart: false,
      balanceMinor: 0,
    })
  })

  // The regression task 15 names: a renumber must not split one account's
  // history into two trial-balance rows.
  it('reads as ONE row with the CURRENT code when the account has been renumbered', async () => {
    // The account posted to as '1100'; it has since been renumbered to '1150'.
    vi.mocked(listChartAccounts).mockResolvedValue(
      ok([
        account({ id: 'id_1100', code: '1150', name: 'Cash (renumbered)', accountType: 'asset' }),
      ])
    )

    const result = await readTrialBalance(stubDb([groupedRow('1100', 125_000, 0, 'id_1100')]), {
      organizationId: ORG,
      to: '2026-08-31',
    })

    const tb = result._unsafeUnwrap()
    expect(tb.rows).toHaveLength(1)
    expect(tb.rows[0]).toMatchObject({
      glAccountId: 'id_1100',
      // The CURRENT code and name, not the '1100' snapshot the line carries.
      accountCode: '1150',
      accountName: 'Cash (renumbered)',
      balanceMinor: 125_000,
      inChart: true,
    })
  })

  // Same rule for a RENAME: a statement reads the chart, never the snapshot -
  // §3's exception is the journal view of one entry (out of this lane's scope),
  // which keeps showing the name it was posted under.
  it('shows the CURRENT name when the account has been renamed', async () => {
    vi.mocked(listChartAccounts).mockResolvedValue(
      ok([account({ id: 'id_1000', code: '1000', name: 'Operating Cash', accountType: 'asset' })])
    )

    const result = await readTrialBalance(stubDb([groupedRow('1000', 100_000, 0, 'id_1000')]), {
      organizationId: ORG,
      to: '2026-08-31',
    })

    expect(result._unsafeUnwrap().rows[0]).toMatchObject({
      glAccountId: 'id_1000',
      accountName: 'Operating Cash',
    })
  })

  it('a reversal pair still shows two entries worth of debit/credit activity, not net zero', async () => {
    // The account itself already reflects a reversal netting to zero via its
    // OWN two balanced sides - this is the presentation, not a re-derivation
    // of `verifyBooksBalance`'s per-posting check.
    vi.mocked(listChartAccounts).mockResolvedValue(
      ok([account({ code: '1000', accountType: 'asset' })])
    )

    const result = await readTrialBalance(stubDb([groupedRow('1000', 200_000, 200_000)]), {
      organizationId: ORG,
      to: '2026-08-31',
    })

    const row = result._unsafeUnwrap().rows[0]
    expect(row?.debitMinor).toBe(200_000)
    expect(row?.creditMinor).toBe(200_000)
    expect(row?.balanceMinor).toBe(0)
  })

  it('coerces the numeric string aggregate rather than comparing strings to numbers', async () => {
    vi.mocked(listChartAccounts).mockResolvedValue(
      ok([account({ code: '1000', accountType: 'asset' })])
    )

    const result = await readTrialBalance(stubDb([groupedRow('1000', 300_000, 0)]), {
      organizationId: ORG,
      to: '2026-08-31',
    })

    expect(result._unsafeUnwrap().rows[0]?.debitMinor).toBe(300_000)
  })

  it('is empty and balanced over an empty ledger', async () => {
    vi.mocked(listChartAccounts).mockResolvedValue(ok([]))

    const result = await readTrialBalance(stubDb([]), { organizationId: ORG, to: '2026-08-31' })

    expect(result._unsafeUnwrap()).toEqual({
      organizationId: ORG,
      from: null,
      to: '2026-08-31',
      rows: [],
      totalDebitMinor: 0,
      totalCreditMinor: 0,
      balanced: true,
    })
  })

  it('returns err rather than throwing when the chart read fails', async () => {
    vi.mocked(listChartAccounts).mockResolvedValue(err(new Error('boom')))

    const result = await readTrialBalance(stubDb([]), { organizationId: ORG, to: '2026-08-31' })
    expect(result.isErr()).toBe(true)
  })

  // Task 15 §5's own regression: a live account with NO code must render
  // `null`, never fall back to the line's snapshot just because both happen
  // to be absent-shaped.
  it('reports a null accountCode for a live, uncoded account rather than the line snapshot', async () => {
    vi.mocked(listChartAccounts).mockResolvedValue(
      ok([
        account({
          id: 'id_x',
          code: null,
          name: 'Imported: Product Income',
          accountType: 'revenue',
        }),
      ])
    )

    const result = await readTrialBalance(
      stubDb([{ glAccountId: 'id_x', accountCode: null, debitMinor: '0', creditMinor: '5000' }]),
      { organizationId: ORG, to: '2026-08-31' }
    )

    const row = result._unsafeUnwrap().rows[0]
    expect(row).toMatchObject({ glAccountId: 'id_x', accountCode: null, inChart: true })
  })

  // 15.2: statement type order first (asset, liability, equity, revenue,
  // expense), then code-then-name within a type - never a bare code sort,
  // which would put a `4...` revenue account ahead of a `2...` liability.
  it('sorts by statement type in order, then by code, then by name', async () => {
    vi.mocked(listChartAccounts).mockResolvedValue(
      ok([
        account({ code: '4000', name: 'Sales', accountType: 'revenue' }),
        account({ code: '1000', name: 'Cash', accountType: 'asset' }),
        account({ code: '2000', name: 'Accounts Payable', accountType: 'liability' }),
      ])
    )

    const result = await readTrialBalance(
      stubDb([groupedRow('4000', 0, 100), groupedRow('1000', 100, 0), groupedRow('2000', 0, 100)]),
      { organizationId: ORG, to: '2026-08-31' }
    )

    expect(result._unsafeUnwrap().rows.map((r) => r.accountCode)).toEqual(['1000', '2000', '4000'])
  })

  // A coded account sorts before an uncoded one of the SAME type, per
  // `compareAccountsByCodeThenName` - never the other way, and never by
  // treating a null code as an empty string that could sort first.
  it('sorts a coded account before an uncoded one of the same statement type', async () => {
    vi.mocked(listChartAccounts).mockResolvedValue(
      ok([
        account({
          id: 'id_uncoded',
          code: null,
          name: 'Zzz Imported Expense',
          accountType: 'expense',
        }),
        account({
          id: 'id_coded',
          code: '6000',
          name: 'Aaa Office Supplies',
          accountType: 'expense',
        }),
      ])
    )

    const result = await readTrialBalance(
      stubDb([
        { glAccountId: 'id_uncoded', accountCode: null, debitMinor: '100', creditMinor: '0' },
        { glAccountId: 'id_coded', accountCode: '6000', debitMinor: '100', creditMinor: '0' },
      ]),
      { organizationId: ORG, to: '2026-08-31' }
    )

    expect(result._unsafeUnwrap().rows.map((r) => r.glAccountId)).toEqual([
      'id_coded',
      'id_uncoded',
    ])
  })
})
