// packages/lib/src/postings/reports/__tests__/adapters.test.ts

import { describe, expect, it } from 'vitest'
import {
  balanceSheetColumns,
  toBalanceSheetRows,
  toProfitAndLossRows,
  toTrialBalanceRows,
} from '../adapters'
import type { BalanceSheetSnapshot } from '../balance-sheet'
import type { ProfitAndLossSnapshot } from '../profit-and-loss'
import type { TrialBalance } from '../trial-balance'

const trialBalance: TrialBalance = {
  organizationId: 'org_1',
  from: null,
  to: '2026-08-31',
  rows: [
    {
      accountCode: '1000',
      accountName: 'Cash',
      accountType: 'asset',
      debitMinor: 100_000,
      creditMinor: 0,
      balanceMinor: 100_000,
      inChart: true,
    },
  ],
  totalDebitMinor: 100_000,
  totalCreditMinor: 100_000,
  balanced: true,
}

describe('toTrialBalanceRows', () => {
  it('one line per account, plus a total row', () => {
    const rows = toTrialBalanceRows(trialBalance)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ id: '1000', kind: 'line', values: [100_000, 0, 100_000] })
    expect(rows[1]).toMatchObject({ id: 'total', kind: 'total', values: [100_000, 100_000, null] })
  })
})

const balanceSheet: BalanceSheetSnapshot = {
  asOf: '2026-08-31',
  assets: [
    {
      accountCode: '1000',
      accountName: 'Cash',
      accountType: 'asset',
      balanceMinor: 900_000,
      inChart: true,
    },
  ],
  liabilities: [
    {
      accountCode: '2000',
      accountName: 'A/P',
      accountType: 'liability',
      balanceMinor: 100_000,
      inChart: true,
    },
  ],
  equity: [
    {
      accountCode: '3000',
      accountName: "Owner's Equity",
      accountType: 'equity',
      balanceMinor: 50_000,
      inChart: true,
    },
  ],
  totalAssetsMinor: 900_000,
  totalLiabilitiesMinor: 100_000,
  totalEquityMinor: 800_000,
  retainedEarnings: {
    balanceMinor: 750_000,
    priorYearsSource: 'rolled_forward',
    priorYearsMinor: 600_000,
    postedPriorYearsMinor: 0,
    currentPeriodMinor: 150_000,
    accountCode: null,
  },
  verdict: true,
}

describe('toBalanceSheetRows', () => {
  it('renders three sections plus the total-liabilities-and-equity row, with both retained-earnings computed rows in Equity', () => {
    const rows = toBalanceSheetRows(balanceSheet)
    expect(rows.map((r) => r.id)).toEqual([
      'assets',
      'liabilities',
      'equity',
      'total-liabilities-equity',
    ])

    const equity = rows.find((r) => r.id === 'equity')
    const computed = equity?.children?.filter((c) => c.kind === 'computed') ?? []
    expect(computed.map((c) => c.id)).toEqual(['re-current', 're-prior'])
    expect(computed.find((c) => c.id === 're-current')?.values).toEqual([150_000])
    expect(computed.find((c) => c.id === 're-prior')?.values).toEqual([600_000])

    const total = rows.find((r) => r.id === 'total-liabilities-equity')
    expect(total?.values).toEqual([900_000])
  })

  it('omits the computed prior-years row only when the roll-forward is zero, never merely because a balance is posted', () => {
    // 🛑 The row tracks `priorYearsMinor`, not `priorYearsSource`. A posted
    // opening retained-earnings balance does not close the prior year's P&L
    // (there is no year-end close in this pass), so an org can have both - and
    // `totalEquityMinor` includes the roll-forward in that case, so the section
    // has to show it or its children stop adding up.
    const postedAndClosed: BalanceSheetSnapshot = {
      ...balanceSheet,
      retainedEarnings: {
        ...balanceSheet.retainedEarnings,
        priorYearsSource: 'posted',
        priorYearsMinor: 0,
        postedPriorYearsMinor: 500_000,
        accountCode: '3100',
      },
    }
    expect(
      toBalanceSheetRows(postedAndClosed)
        .find((r) => r.id === 'equity')
        ?.children?.filter((c) => c.kind === 'computed')
        .map((c) => c.id)
    ).toEqual(['re-current'])

    const postedAndTrading: BalanceSheetSnapshot = {
      ...balanceSheet,
      retainedEarnings: {
        ...balanceSheet.retainedEarnings,
        priorYearsSource: 'posted',
        priorYearsMinor: 180_000,
        postedPriorYearsMinor: 500_000,
        accountCode: '3100',
      },
    }
    const computed =
      toBalanceSheetRows(postedAndTrading)
        .find((r) => r.id === 'equity')
        ?.children?.filter((c) => c.kind === 'computed') ?? []
    expect(computed.map((c) => c.id)).toEqual(['re-current', 're-prior'])
    expect(computed.find((c) => c.id === 're-prior')?.values).toEqual([180_000])
  })

  it('adds a second column, and a per-account compare value, when a compare snapshot is given', () => {
    const compare: BalanceSheetSnapshot = {
      ...balanceSheet,
      asOf: '2026-07-31',
      totalAssetsMinor: 800_000,
    }
    const columns = balanceSheetColumns({ ...balanceSheet, compare })
    expect(columns).toHaveLength(2)

    const rows = toBalanceSheetRows(balanceSheet, compare)
    const assets = rows.find((r) => r.id === 'assets')
    expect(assets?.values).toEqual([900_000, 800_000])
  })
})

const profitAndLoss: ProfitAndLossSnapshot = {
  from: '2026-08-01',
  to: '2026-08-31',
  revenue: [
    {
      accountCode: '4000',
      accountName: 'Product Revenue',
      accountType: 'revenue',
      balanceMinor: 500_000,
      inChart: true,
    },
  ],
  totalRevenueMinor: 500_000,
  cogs: [
    {
      accountCode: '5000',
      accountName: 'COGS',
      accountType: 'expense',
      balanceMinor: 200_000,
      inChart: true,
    },
  ],
  totalCogsMinor: 200_000,
  grossProfitMinor: 300_000,
  operatingExpenses: [
    {
      accountCode: '6100',
      accountName: 'Merchant Fees',
      accountType: 'expense',
      balanceMinor: 50_000,
      inChart: true,
    },
  ],
  totalOperatingExpensesMinor: 50_000,
  totalExpenseMinor: 250_000,
  netIncomeMinor: 250_000,
}

describe('toProfitAndLossRows', () => {
  it('separates cost of goods sold from operating expense, and ends on net income', () => {
    const rows = toProfitAndLossRows(profitAndLoss)
    expect(rows.map((r) => r.id)).toEqual([
      'revenue',
      'cogs',
      'gross-profit',
      'operating-expenses',
      'net-income',
    ])

    const netIncome = rows.find((r) => r.id === 'net-income')
    expect(netIncome?.kind).toBe('total')
    expect(netIncome?.values).toEqual([250_000])

    const grossProfit = rows.find((r) => r.id === 'gross-profit')
    expect(grossProfit?.kind).toBe('computed')
    expect(grossProfit?.values).toEqual([300_000])
  })
})
