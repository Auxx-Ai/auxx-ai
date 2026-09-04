// packages/lib/src/postings/reports/__tests__/net-income-matches-retained-earnings.test.ts
//
// Definition-of-done bullet from `tasks/04-statements.md` §5: "P&L net income
// equals the retained-earnings movement." Both readers are built over the same
// `readTrialBalance`, mocked once here so both sides of the check use
// identical fixture data - the property under test is that the two READERS
// agree, not that any one fixture is realistic.

import type { Database } from '@auxx/database'
import { ok } from 'neverthrow'
import { describe, expect, it, vi } from 'vitest'
import type { TrialBalance, TrialBalanceRow } from '../trial-balance'

vi.mock('../trial-balance', () => ({ readTrialBalance: vi.fn() }))
vi.mock('../../resolve-roles', () => ({ loadRoleAccountCodes: vi.fn() }))
// The balance sheet reads the chart once and hands it to every trial-balance
// read, so it touches `role-map` directly.
vi.mock('../../role-map', () => ({ listChartAccounts: vi.fn() }))

import { loadRoleAccountCodes } from '../../resolve-roles'
import { listChartAccounts } from '../../role-map'
import { readBalanceSheet } from '../balance-sheet'
import { readProfitAndLoss } from '../profit-and-loss'
import { readTrialBalance } from '../trial-balance'

const ORG = 'org_1'

function row(overrides: Partial<TrialBalanceRow> & { accountCode: string }): TrialBalanceRow {
  return {
    accountName: '',
    accountType: 'asset',
    debitMinor: 0,
    creditMinor: 0,
    balanceMinor: 0,
    inChart: true,
    ...overrides,
  }
}

function tb(rows: TrialBalanceRow[], to: string, from: string | null = null): TrialBalance {
  return {
    organizationId: ORG,
    from,
    to,
    rows,
    totalDebitMinor: rows.reduce((s, r) => s + r.debitMinor, 0),
    totalCreditMinor: rows.reduce((s, r) => s + r.creditMinor, 0),
    balanced: true,
  }
}

function stubDb(): Database {
  return {} as unknown as Database
}

describe('P&L net income vs. balance-sheet retained-earnings movement', () => {
  it('the current period net income the balance sheet rolls forward is exactly the P&L net income for the same range', async () => {
    vi.mocked(loadRoleAccountCodes).mockResolvedValue(new Map())
    vi.mocked(listChartAccounts).mockResolvedValue(ok([]))

    const currentFyRows = [
      row({
        accountCode: '4000',
        accountType: 'revenue',
        creditMinor: 400_000,
        balanceMinor: 400_000,
      }),
      row({
        accountCode: '5000',
        accountType: 'expense',
        debitMinor: 150_000,
        balanceMinor: 150_000,
      }),
    ]

    vi.mocked(readTrialBalance).mockImplementation(async (_db, options) => {
      if (options.from) return ok(tb(currentFyRows, options.to, options.from))
      if (options.to.endsWith('-12-31')) return ok(tb([], options.to))
      return ok(
        tb(
          [
            row({
              accountCode: '1000',
              accountType: 'asset',
              debitMinor: 250_000,
              balanceMinor: 250_000,
            }),
          ],
          options.to
        )
      )
    })

    const balanceSheet = await readBalanceSheet(stubDb(), {
      organizationId: ORG,
      asOf: '2026-08-31',
    })
    const profitAndLoss = await readProfitAndLoss(stubDb(), {
      organizationId: ORG,
      from: '2026-01-01',
      to: '2026-08-31',
    })

    const bs = balanceSheet._unsafeUnwrap()
    const pl = profitAndLoss._unsafeUnwrap()

    expect(pl.netIncomeMinor).toBe(250_000)
    expect(bs.retainedEarnings.currentPeriodMinor).toBe(pl.netIncomeMinor)
  })
})
