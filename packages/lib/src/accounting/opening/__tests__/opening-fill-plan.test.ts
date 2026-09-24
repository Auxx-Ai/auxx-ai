// packages/lib/src/accounting/opening/__tests__/opening-fill-plan.test.ts
//
// `planProviderOpeningFill` is pure - no database, no doubles - so every test
// here hands it a hand-built `ProviderBalanceSheet` and a trial balance view's
// `rows`, and reads the plan back.

import { describe, expect, it } from 'vitest'
import { UnprocessableEntityError } from '../../../errors'
import { ACCOUNT_ROLES } from '../../ledger/builders/entry'
import type { ProviderBalanceRow, ProviderBalanceSheet } from '../../ledger/types'
import type { OpeningTrialBalanceRow } from '../client'
import { rowsToJournalEntryLines } from '../client'
import { planProviderOpeningFill } from '../opening-fill-plan'

function row(over: Partial<OpeningTrialBalanceRow> = {}): OpeningTrialBalanceRow {
  return {
    accountId: 'acc',
    accountCode: null,
    accountName: 'Account',
    accountType: 'asset',
    isActive: true,
    debitMinor: null,
    creditMinor: null,
    ...over,
  }
}

function accountRow(over: Partial<ProviderBalanceRow> = {}): ProviderBalanceRow {
  return {
    providerAccountId: 'p1',
    name: 'Account',
    kind: 'account',
    minorSigned: 0,
    ...over,
  }
}

function netIncomeRow(minorSigned: number): ProviderBalanceRow {
  return { providerAccountId: null, name: 'Net Income', kind: 'net_income', minorSigned }
}

function sheet(
  rows: ProviderBalanceRow[],
  over: Partial<ProviderBalanceSheet> = {}
): ProviderBalanceSheet {
  return {
    asOf: '2025-12-31',
    currency: 'USD',
    reportBasis: 'Accrual',
    hasData: true,
    rows,
    ...over,
  }
}

describe('a full fill', () => {
  it('balances to zero when every linked row gets the providers figure', () => {
    const checking = row({ accountId: 'checking', accountCode: '1000', accountName: 'Checking' })
    const savings = row({ accountId: 'savings', accountCode: '1010', accountName: 'Savings' })
    const ap = row({
      accountId: 'ap',
      accountCode: '2000',
      accountName: 'Accounts Payable',
      accountType: 'liability',
    })
    const re = row({
      accountId: 're',
      accountCode: '3010',
      accountName: 'Retained Earnings',
      accountType: 'equity',
    })

    const plan = planProviderOpeningFill({
      sheet: sheet([
        accountRow({ providerAccountId: 'p_checking', name: 'Checking', minorSigned: 500_000 }),
        accountRow({ providerAccountId: 'p_savings', name: 'Savings', minorSigned: 300_000 }),
        accountRow({ providerAccountId: 'p_ap', name: 'Accounts Payable', minorSigned: -200_000 }),
        accountRow({
          providerAccountId: 'p_re',
          name: 'Retained Earnings',
          minorSigned: -600_000,
        }),
      ]),
      rows: [checking, savings, ap, re],
      accountMap: new Map([
        ['checking', 'p_checking'],
        ['savings', 'p_savings'],
        ['ap', 'p_ap'],
        ['re', 'p_re'],
      ]),
      roleAccounts: new Map(),
    })

    expect(plan.differenceMinor).toBe(0)
    expect(plan.filledCount).toBe(4)
    expect(plan.unmatched).toEqual([])
    expect(plan.rows.find((r) => r.accountId === 'checking')).toMatchObject({
      debitMinor: 500_000,
      creditMinor: null,
    })
    expect(plan.rows.find((r) => r.accountId === 'ap')).toMatchObject({
      debitMinor: null,
      creditMinor: 200_000,
    })
  })
})

describe('inventory comes from the provider like every other account (103 §5a)', () => {
  it('puts a single provider Inventory Asset on the finished-goods account it is linked to', () => {
    const rawMaterials = row({ accountId: 'raw', accountCode: '1310', debitMinor: 99_999 })
    const finishedGoods = row({ accountId: 'fg', accountCode: '1330' })
    const equity = row({ accountId: 'obe', accountType: 'equity' })

    const plan = planProviderOpeningFill({
      sheet: sheet([
        accountRow({ providerAccountId: 'p_inv', name: 'Inventory Asset', minorSigned: 42_000 }),
        accountRow({ providerAccountId: 'p_obe', name: 'Opening Equity', minorSigned: -42_000 }),
      ]),
      rows: [rawMaterials, finishedGoods, equity],
      accountMap: new Map([
        ['fg', 'p_inv'],
        ['obe', 'p_obe'],
      ]),
      roleAccounts: new Map(),
    })

    expect(plan.rows.find((r) => r.accountId === 'fg')).toMatchObject({ debitMinor: 42_000 })
    // An unlinked row is cleared, never kept at a stale figure.
    expect(plan.rows.find((r) => r.accountId === 'raw')).toMatchObject({
      debitMinor: null,
      creditMinor: null,
    })
    expect(plan.unmatched).toEqual([])
    expect(plan.differenceMinor).toBe(0)
    expect(rowsToJournalEntryLines(plan.rows)).toContainEqual({
      glAccountId: 'fg',
      direction: 'debit',
      amountMinor: 42_000,
    })
  })

  it('fills each of three separate provider inventory accounts onto its own linked account', () => {
    const plan = planProviderOpeningFill({
      sheet: sheet([
        accountRow({ providerAccountId: 'p_raw', minorSigned: 1_000 }),
        accountRow({ providerAccountId: 'p_wip', minorSigned: 200 }),
        accountRow({ providerAccountId: 'p_fg', minorSigned: 3_000 }),
      ]),
      rows: [row({ accountId: 'raw' }), row({ accountId: 'wip' }), row({ accountId: 'fg' })],
      accountMap: new Map([
        ['raw', 'p_raw'],
        ['wip', 'p_wip'],
        ['fg', 'p_fg'],
      ]),
      roleAccounts: new Map(),
    })

    expect(plan.rows.map((r) => r.debitMinor)).toEqual([1_000, 200, 3_000])
    expect(plan.filledCount).toBe(3)
  })
})

describe('net income', () => {
  it('folds into retained earnings and re-derives the sums sign', () => {
    const retainedEarnings = row({
      accountId: 're',
      accountCode: '3010',
      accountName: 'Retained Earnings',
      accountType: 'equity',
    })

    const plan = planProviderOpeningFill({
      sheet: sheet([
        accountRow({ providerAccountId: 'p_re', name: 'Retained Earnings', minorSigned: -173_885 }),
        netIncomeRow(-9_639),
      ]),
      rows: [retainedEarnings],
      accountMap: new Map([['re', 'p_re']]),
      roleAccounts: new Map([[ACCOUNT_ROLES.EQUITY_RETAINED_EARNINGS, 're']]),
    })

    expect(plan.netIncome).toEqual({ minorSigned: -9_639, foldedIntoGlAccountId: 're' })
    expect(plan.rows[0]).toMatchObject({ debitMinor: null, creditMinor: 183_524 })
  })

  it('reads an absent or zero net income row as no fold at all', () => {
    const retainedEarnings = row({ accountId: 're', accountCode: '3010', accountType: 'equity' })

    const plan = planProviderOpeningFill({
      sheet: sheet([
        accountRow({ providerAccountId: 'p_re', minorSigned: -173_885 }),
        netIncomeRow(0),
      ]),
      rows: [retainedEarnings],
      accountMap: new Map([['re', 'p_re']]),
      roleAccounts: new Map([[ACCOUNT_ROLES.EQUITY_RETAINED_EARNINGS, 're']]),
    })

    expect(plan.netIncome).toBeNull()
    expect(plan.rows[0]).toMatchObject({ debitMinor: null, creditMinor: 173_885 })
  })

  it('throws naming the role when no account carries equity_retained_earnings and net income is non-zero', () => {
    expect(() =>
      planProviderOpeningFill({
        sheet: sheet([netIncomeRow(-9_639)]),
        rows: [row({ accountId: 'checking' })],
        accountMap: new Map(),
        roleAccounts: new Map(),
      })
    ).toThrowError(UnprocessableEntityError)

    try {
      planProviderOpeningFill({
        sheet: sheet([netIncomeRow(-9_639)]),
        rows: [row({ accountId: 'checking' })],
        accountMap: new Map(),
        roleAccounts: new Map(),
      })
      expect.unreachable()
    } catch (error) {
      expect(String((error as Error).message)).toContain('equity_retained_earnings')
    }
  })
})

describe('a provider id claimed by more than one of our accounts', () => {
  it('throws naming both accounts, without ever reading the sheet', () => {
    const accountA = row({ accountId: 'accA', accountCode: '1000', accountName: 'Checking' })
    const accountB = row({
      accountId: 'accB',
      accountCode: '1001',
      accountName: 'Checking Clone',
    })

    let thrown: unknown
    try {
      planProviderOpeningFill({
        sheet: sheet([]),
        rows: [accountA, accountB],
        accountMap: new Map([
          ['accA', 'p_dup'],
          ['accB', 'p_dup'],
        ]),
        roleAccounts: new Map(),
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(UnprocessableEntityError)
    expect(String((thrown as Error).message)).toContain('1000 Checking')
    expect(String((thrown as Error).message)).toContain('1001 Checking Clone')
  })
})

describe('unmatched', () => {
  it('lists a provider row with no account of ours, and one whose target chart row has been archived, and totals them', () => {
    const ap = row({ accountId: 'ap', accountCode: '2000', accountType: 'liability' })
    // `archived` is mapped in `accountMap` (a mapping survives archiving) but is
    // NOT present in `rows`, because `listChartAccounts` excludes archived rows.

    const plan = planProviderOpeningFill({
      sheet: sheet([
        accountRow({ providerAccountId: 'p_ap', minorSigned: -100_000 }),
        accountRow({ providerAccountId: 'p_unknown', name: 'Old Clearing', minorSigned: -50_000 }),
        accountRow({
          providerAccountId: 'p_archived',
          name: 'Retired Account',
          minorSigned: 30_000,
        }),
      ]),
      rows: [ap],
      accountMap: new Map([
        ['ap', 'p_ap'],
        ['archived', 'p_archived'],
      ]),
      roleAccounts: new Map(),
    })

    expect(plan.unmatched).toEqual(
      expect.arrayContaining([
        { providerAccountId: 'p_unknown', name: 'Old Clearing', minorSigned: -50_000 },
        { providerAccountId: 'p_archived', name: 'Retired Account', minorSigned: 30_000 },
      ])
    )
    expect(plan.unmatched).toHaveLength(2)
    expect(plan.unmatchedTotalMinor).toBe(-50_000 + 30_000)
  })
})
