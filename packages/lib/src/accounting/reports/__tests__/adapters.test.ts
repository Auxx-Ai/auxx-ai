// packages/lib/src/accounting/reports/__tests__/adapters.test.ts

import { describe, expect, it } from 'vitest'
import type { ChartAccountRow } from '../../ledger/types'
import {
  balanceSheetColumns,
  nestAccountLines,
  toBalanceSheetRows,
  toProfitAndLossRows,
  toTrialBalanceRows,
  toTrialBalanceStatementRows,
} from '../adapters'
import type { BalanceSheetSnapshot } from '../balance-sheet'
import type { ProfitAndLossSnapshot } from '../profit-and-loss'
import type { TrialBalance } from '../trial-balance'

/** A minimal `ChartAccountRow`, matching `account-tree.test.ts`'s own fixture shape. */
function account(over: Partial<ChartAccountRow> & { id: string }): ChartAccountRow {
  return {
    code: null,
    name: over.id,
    accountType: 'asset',
    subtype: null,
    parentId: null,
    isActive: true,
    ...over,
  }
}

const trialBalance: TrialBalance = {
  organizationId: 'org_1',
  from: null,
  to: '2026-08-31',
  rows: [
    {
      glAccountId: 'acct_1000',
      accountCode: '1000',
      accountName: 'Cash',
      accountType: 'asset',
      subtype: null,
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
    // The row id is the account's IDENTITY (task 15), not its code.
    expect(rows[0]).toMatchObject({ id: 'acct_1000', kind: 'line', values: [100_000, 0, 100_000] })
    expect(rows[0]?.meta).toMatchObject({ glAccountId: 'acct_1000', accountCode: '1000' })
    expect(rows[1]).toMatchObject({ id: 'total', kind: 'total', values: [100_000, 100_000, null] })
  })
})

const balanceSheet: BalanceSheetSnapshot = {
  asOf: '2026-08-31',
  assets: [
    {
      glAccountId: 'acct_1000',
      accountCode: '1000',
      accountName: 'Cash',
      accountType: 'asset',
      balanceMinor: 900_000,
      inChart: true,
    },
  ],
  liabilities: [
    {
      glAccountId: 'acct_2000',
      accountCode: '2000',
      accountName: 'A/P',
      accountType: 'liability',
      balanceMinor: 100_000,
      inChart: true,
    },
  ],
  equity: [
    {
      glAccountId: 'acct_3000',
      accountCode: '3000',
      accountName: "Owner's Equity",
      accountType: 'equity',
      balanceMinor: 50_000,
      inChart: true,
    },
  ],
  customerDeposits: [],
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

describe('customer deposits split (91 D3)', () => {
  const withDeposits: BalanceSheetSnapshot = {
    ...balanceSheet,
    assets: [
      ...balanceSheet.assets,
      {
        glAccountId: 'acct_1100',
        accountCode: '1100',
        accountName: 'Shopify receivable',
        accountType: 'asset',
        balanceMinor: 30_000,
        inChart: true,
      },
    ],
    customerDeposits: [
      {
        glAccountId: 'acct_1100',
        accountCode: '1100',
        accountName: 'Shopify receivable',
        balanceMinor: 12_000,
      },
    ],
    totalAssetsMinor: 930_000,
    totalLiabilitiesMinor: 112_000,
  }

  it('puts a computed, non-drillable deposits row under Liabilities and notes the receivable', () => {
    const rows = toBalanceSheetRows(withDeposits)
    const liabilities = rows.find((r) => r.id === 'liabilities')
    const deposits = liabilities?.children?.find((c) => c.id === 'customer-deposits:acct_1100')
    expect(deposits).toMatchObject({
      kind: 'computed',
      label: '1100 Shopify receivable - customer deposits',
      values: [12_000],
    })
    expect(deposits?.meta?.glAccountId).toBeUndefined()
    expect(deposits?.meta?.note).toMatch(/Not a posted balance/)
    expect(deposits?.label).not.toMatch(/[–—]/)
    expect(liabilities?.values).toEqual([112_000])

    const receivable = rows
      .find((r) => r.id === 'assets')
      ?.children?.find((c) => c.id === 'acct_1100')
    expect(receivable?.values).toEqual([30_000])
    expect(receivable?.meta?.note).toMatch(/customer deposits/)
  })

  it('renders a deposits row present in only one snapshot with an empty cell in the other', () => {
    const rows = toBalanceSheetRows(withDeposits, balanceSheet)
    const deposits = rows
      .find((r) => r.id === 'liabilities')
      ?.children?.find((c) => c.id === 'customer-deposits:acct_1100')
    expect(deposits?.values).toEqual([12_000, null])
  })

  it('moves a receivable credit to a computed row in the trial balance statement, totals unchanged', () => {
    const rows = toTrialBalanceStatementRows({
      organizationId: 'org_1',
      asOf: '2026-08-31',
      fiscalYearStart: '2026-01-01',
      chart: [],
      rows: [
        {
          glAccountId: 'acct_1100',
          accountCode: '1100',
          accountName: 'Shopify receivable',
          accountType: 'asset',
          subtype: 'accounts_receivable',
          debitMinor: 50_000,
          creditMinor: 32_000,
          balanceMinor: 18_000,
          inChart: true,
          receivableSplit: { receivableMinor: 30_000, depositsMinor: 12_000 },
        },
        {
          glAccountId: 'acct_2000',
          accountCode: '2000',
          accountName: 'A/P',
          accountType: 'liability',
          subtype: null,
          debitMinor: 0,
          creditMinor: 18_000,
          balanceMinor: 18_000,
          inChart: true,
        },
      ],
      retainedEarnings: {
        balanceMinor: 0,
        priorYearsSource: 'rolled_forward',
        priorYearsMinor: 0,
        postedPriorYearsMinor: 0,
        currentPeriodMinor: 0,
        accountCode: null,
        plugDebitMinor: 0,
        plugCreditMinor: 0,
      },
      totalDebitMinor: 50_000,
      totalCreditMinor: 50_000,
      balanced: true,
    })
    expect(rows.map((r) => r.id)).toEqual([
      'acct_1100',
      'acct_2000',
      'customer-deposits:acct_1100',
      'total',
    ])
    expect(rows[0]?.values).toEqual([50_000, 32_000, 30_000])
    expect(rows[2]).toMatchObject({ kind: 'computed', values: [null, null, 12_000] })
    expect(rows[2]?.meta?.glAccountId).toBeUndefined()
    expect(rows[3]?.values).toEqual([50_000, 50_000, null])
  })
})

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
      glAccountId: 'acct_4000',
      accountCode: '4000',
      accountName: 'Product Revenue',
      accountType: 'revenue',
      subtype: null,
      balanceMinor: 500_000,
      inChart: true,
    },
  ],
  totalRevenueMinor: 500_000,
  cogs: [
    {
      glAccountId: 'acct_5000',
      accountCode: '5000',
      accountName: 'COGS',
      accountType: 'expense',
      subtype: 'cost_of_goods_sold',
      balanceMinor: 200_000,
      inChart: true,
    },
  ],
  totalCogsMinor: 200_000,
  grossProfitMinor: 300_000,
  operatingExpenses: [
    {
      glAccountId: 'acct_6100',
      accountCode: '6100',
      accountName: 'Merchant Fees',
      accountType: 'expense',
      subtype: null,
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

// CHART-HIERARCHY.md §5: Sales (parent, own postings) with two children,
// Product Income sorting before Service Income by code.
const salesChart: ChartAccountRow[] = [
  account({ id: 'acct_sales', code: '4000', name: 'Sales', accountType: 'revenue' }),
  account({
    id: 'acct_product',
    code: '4010',
    name: 'Product Income',
    accountType: 'revenue',
    parentId: 'acct_sales',
  }),
  account({
    id: 'acct_service',
    code: '4020',
    name: 'Service Income',
    accountType: 'revenue',
    parentId: 'acct_sales',
  }),
]

const nestedRevenue: ProfitAndLossSnapshot = {
  from: '2026-08-01',
  to: '2026-08-31',
  revenue: [
    {
      glAccountId: 'acct_sales',
      accountCode: '4000',
      accountName: 'Sales',
      accountType: 'revenue',
      subtype: null,
      balanceMinor: 100_00,
      inChart: true,
    },
    {
      glAccountId: 'acct_product',
      accountCode: '4010',
      accountName: 'Product Income',
      accountType: 'revenue',
      subtype: null,
      balanceMinor: 250_00,
      inChart: true,
    },
    {
      glAccountId: 'acct_service',
      accountCode: '4020',
      accountName: 'Service Income',
      accountType: 'revenue',
      subtype: null,
      balanceMinor: 50_00,
      inChart: true,
    },
  ],
  totalRevenueMinor: 400_00,
  cogs: [],
  totalCogsMinor: 0,
  grossProfitMinor: 400_00,
  operatingExpenses: [],
  totalOperatingExpensesMinor: 0,
  totalExpenseMinor: 0,
  netIncomeMinor: 400_00,
}

describe('toProfitAndLossRows nesting (CHART-HIERARCHY.md §5)', () => {
  it('nests Product Income and Service Income under Sales, with a Total Sales subtotal', () => {
    const rows = toProfitAndLossRows(nestedRevenue, null, salesChart)
    const revenue = rows.find((r) => r.id === 'revenue')
    expect(revenue?.children?.map((c) => ({ id: c.id, depth: c.depth, kind: c.kind }))).toEqual([
      { id: 'acct_sales', depth: 1, kind: 'line' },
      { id: 'acct_product', depth: 2, kind: 'line' },
      { id: 'acct_service', depth: 2, kind: 'line' },
      { id: 'acct_sales:total', depth: 2, kind: 'subtotal' },
      // `totalRow` (rows.ts) always builds at depth 0 - the table floors a
      // child to `depth + 1` at render time (`statement-table.tsx`), so this
      // is unaffected by nesting, not a second subtotal mechanism.
      { id: 'revenue:total', depth: 0, kind: 'total' },
    ])

    expect(revenue?.children?.find((c) => c.id === 'acct_sales')?.values).toEqual([100_00])
    expect(revenue?.children?.find((c) => c.id === 'acct_product')?.values).toEqual([250_00])
    expect(revenue?.children?.find((c) => c.id === 'acct_service')?.values).toEqual([50_00])
    // Own balance plus every descendant - the whole reason a reader looks here.
    expect(revenue?.children?.find((c) => c.id === 'acct_sales:total')?.values).toEqual([400_00])
    // The section total is untouched: it already summed the flat rows.
    expect(revenue?.values).toEqual([400_00])
  })

  it('sums each compare column independently through the same subtotal', () => {
    const compare: ProfitAndLossSnapshot = {
      ...nestedRevenue,
      revenue: nestedRevenue.revenue.map((row) => ({ ...row, balanceMinor: row.balanceMinor / 2 })),
      totalRevenueMinor: 200_00,
    }
    const rows = toProfitAndLossRows(nestedRevenue, compare, salesChart)
    const revenue = rows.find((r) => r.id === 'revenue')
    expect(revenue?.children?.find((c) => c.id === 'acct_sales:total')?.values).toEqual([
      400_00, 200_00,
    ])
  })

  it('omits nesting when no chart is given - unchanged, flat behaviour', () => {
    const rows = toProfitAndLossRows(nestedRevenue)
    const revenue = rows.find((r) => r.id === 'revenue')
    expect(revenue?.children?.map((c) => c.id)).toEqual([
      'acct_sales',
      'acct_product',
      'acct_service',
      'revenue:total',
    ])
    expect(revenue?.children?.slice(0, 3).every((c) => c.depth === 1)).toBe(true)
  })

  it('keeps a parent in its own section when a child crosses the COGS/operating subtype boundary', () => {
    // Shipping (operating expense) is the parent of Freight-in (COGS) - a real
    // shape (D3 only requires the same accountType, not the same subtype).
    const shippingChart: ChartAccountRow[] = [
      account({ id: 'acct_shipping', code: '6200', name: 'Shipping', accountType: 'expense' }),
      account({
        id: 'acct_freight_in',
        code: '5100',
        name: 'Freight-in',
        accountType: 'expense',
        subtype: 'cost_of_goods_sold',
        parentId: 'acct_shipping',
      }),
    ]
    const pl: ProfitAndLossSnapshot = {
      ...profitAndLoss,
      cogs: [
        {
          glAccountId: 'acct_freight_in',
          accountCode: '5100',
          accountName: 'Freight-in',
          accountType: 'expense',
          subtype: 'cost_of_goods_sold',
          balanceMinor: 300_00,
          inChart: true,
        },
      ],
      totalCogsMinor: 300_00,
      operatingExpenses: [
        {
          glAccountId: 'acct_shipping',
          accountCode: '6200',
          accountName: 'Shipping',
          accountType: 'expense',
          subtype: null,
          balanceMinor: 500_00,
          inChart: true,
        },
      ],
      totalOperatingExpensesMinor: 500_00,
    }

    const rows = toProfitAndLossRows(pl, null, shippingChart)

    const cogs = rows.find((r) => r.id === 'cogs')
    expect(cogs?.children?.map((c) => ({ id: c.id, depth: c.depth, kind: c.kind }))).toEqual([
      { id: 'acct_freight_in', depth: 1, kind: 'line' },
      { id: 'cogs:total', depth: 1, kind: 'subtotal' },
    ])
    expect(cogs?.children?.some((c) => c.id === 'acct_shipping')).toBe(false)
    expect(cogs?.children?.some((c) => c.id === 'acct_shipping:total')).toBe(false)

    const opex = rows.find((r) => r.id === 'operating-expenses')
    expect(opex?.children?.map((c) => ({ id: c.id, depth: c.depth, kind: c.kind }))).toEqual([
      { id: 'acct_shipping', depth: 1, kind: 'line' },
      { id: 'operating-expenses:total', depth: 0, kind: 'total' },
    ])
    expect(opex?.children?.find((c) => c.id === 'acct_shipping')?.values).toEqual([500_00])
    expect(opex?.children?.some((c) => c.id === 'acct_shipping:total')).toBe(false)

    // No account renders twice across the whole statement.
    const glAccountIds = rows
      .flatMap((r) => r.children ?? [])
      .map((c) => c.meta?.glAccountId)
      .filter((id): id is string => !!id)
    expect(new Set(glAccountIds).size).toBe(glAccountIds.length)
  })
})

describe('toBalanceSheetRows nesting (CHART-HIERARCHY.md §5)', () => {
  it('renders an ancestor with no postings of its own as a zero connecting line', () => {
    const chart: ChartAccountRow[] = [
      account({ id: 'acct_bank', code: '1000', name: 'Bank', accountType: 'asset' }),
      account({
        id: 'acct_checking',
        code: '1010',
        name: 'Checking',
        accountType: 'asset',
        parentId: 'acct_bank',
      }),
    ]
    const bs: BalanceSheetSnapshot = {
      ...balanceSheet,
      assets: [
        {
          glAccountId: 'acct_checking',
          accountCode: '1010',
          accountName: 'Checking',
          accountType: 'asset',
          balanceMinor: 900_000,
          inChart: true,
        },
      ],
    }

    const rows = toBalanceSheetRows(bs, null, chart)
    const assets = rows.find((r) => r.id === 'assets')
    expect(assets?.children?.map((c) => ({ id: c.id, depth: c.depth, values: c.values }))).toEqual([
      { id: 'acct_bank', depth: 1, values: [0] },
      { id: 'acct_checking', depth: 2, values: [900_000] },
      { id: 'acct_bank:total', depth: 2, values: [900_000] },
      { id: 'assets:total', depth: 1, values: [900_000] },
    ])
    // The phantom ancestor has no drill key, same as any other zero row would.
    expect(assets?.children?.find((c) => c.id === 'acct_bank')?.meta?.glAccountId).toBe('acct_bank')
  })
})

describe('nestAccountLines', () => {
  it('is a no-op flat map when chart is undefined', () => {
    const rows = [{ glAccountId: 'a', inChart: true }]
    const lines = nestAccountLines(rows, undefined, 1, (row) => ({
      id: row.glAccountId,
      label: row.glAccountId,
      depth: 1,
      kind: 'line',
      values: [1],
    }))
    expect(lines).toEqual([{ id: 'a', label: 'a', depth: 1, kind: 'line', values: [1] }])
  })

  it('keeps an inChart: false row flat at the base depth, chart or not', () => {
    const chart: ChartAccountRow[] = [account({ id: 'a' })]
    const rows = [{ glAccountId: 'gone', inChart: false }]
    const lines = nestAccountLines(rows, chart, 1, (row) => ({
      id: row.glAccountId,
      label: 'Deleted account',
      depth: 1,
      kind: 'line',
      values: [1],
    }))
    expect(lines).toEqual([
      { id: 'gone', label: 'Deleted account', depth: 1, kind: 'line', values: [1] },
    ])
  })
})
