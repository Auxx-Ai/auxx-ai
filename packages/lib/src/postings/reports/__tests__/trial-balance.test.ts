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

function groupedRow(accountCode: string, debit: number, credit: number) {
  return { accountCode, debitMinor: String(debit), creditMinor: String(credit) }
}

function account(overrides: Partial<ChartAccountRow> & { code: string }): ChartAccountRow {
  return {
    id: `id_${overrides.code}`,
    name: '',
    accountType: 'asset',
    isActive: true,
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
        accountCode: '1000',
        accountName: 'Cash',
        accountType: 'asset',
        debitMinor: 125_000,
        creditMinor: 0,
        balanceMinor: 125_000,
        inChart: true,
      },
      {
        accountCode: '2000',
        accountName: 'Accounts Payable',
        accountType: 'liability',
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

  it('flags an account code with posted lines but no live chart row', async () => {
    vi.mocked(listChartAccounts).mockResolvedValue(ok([]))

    const result = await readTrialBalance(stubDb([groupedRow('9999', 100, 0)]), {
      organizationId: ORG,
      to: '2026-08-31',
    })

    const row = result._unsafeUnwrap().rows[0]
    expect(row).toMatchObject({
      accountCode: '9999',
      accountType: null,
      inChart: false,
      balanceMinor: 0,
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
})
