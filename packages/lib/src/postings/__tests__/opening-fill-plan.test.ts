// packages/lib/src/postings/__tests__/opening-fill-plan.test.ts
//
// `planProviderOpeningFill` is pure - no database, no doubles - so every test
// here hands it a hand-built `ProviderBalanceSheet` and a trial balance view's
// `rows`, and reads the plan back.

import { describe, expect, it } from 'vitest'
import { UnprocessableEntityError } from '../../errors'
import { ACCOUNT_ROLES } from '../build-entry'
import { planProviderOpeningFill } from '../opening-fill-plan'
import type { OpeningTrialBalanceRow } from '../opening-trial-balance/client'
import { rowsToJournalEntryLines } from '../opening-trial-balance/client'
import type { ProviderBalanceRow, ProviderBalanceSheet } from '../types'

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

describe('the inventory rule', () => {
  it('keeps the locked count value in `rows` and puts the providers figure in `inventory`, null count staying null', () => {
    const rawMaterials = row({
      accountId: 'rawMaterials',
      accountCode: '1310',
      accountName: 'Raw Materials',
      lockedByRole: ACCOUNT_ROLES.INVENTORY_RAW_MATERIALS,
      debitMinor: 50_000,
    })
    const wip = row({
      accountId: 'wip',
      accountCode: '1320',
      accountName: 'WIP',
      lockedByRole: ACCOUNT_ROLES.INVENTORY_WIP,
      debitMinor: null, // nobody has typed a count yet
    })
    const finishedGoods = row({
      accountId: 'finishedGoods',
      accountCode: '1330',
      accountName: 'Finished Goods',
      lockedByRole: ACCOUNT_ROLES.INVENTORY_FINISHED_GOODS,
      debitMinor: 20_000,
    })

    const plan = planProviderOpeningFill({
      sheet: sheet([
        accountRow({ providerAccountId: 'p_raw', name: 'Inventory Asset', minorSigned: 60_000 }),
        accountRow({ providerAccountId: 'p_wip', name: 'Inventory Asset', minorSigned: 25_000 }),
        accountRow({ providerAccountId: 'p_fg', name: 'Inventory Asset', minorSigned: 15_000 }),
      ]),
      rows: [rawMaterials, wip, finishedGoods],
      accountMap: new Map([
        ['rawMaterials', 'p_raw'],
        ['wip', 'p_wip'],
        ['finishedGoods', 'p_fg'],
      ]),
      roleAccounts: new Map([
        [ACCOUNT_ROLES.INVENTORY_RAW_MATERIALS, 'rawMaterials'],
        [ACCOUNT_ROLES.INVENTORY_WIP, 'wip'],
        [ACCOUNT_ROLES.INVENTORY_FINISHED_GOODS, 'finishedGoods'],
      ]),
    })

    expect(plan.inventoryRefusal).toBeNull()
    expect(plan.inventory).toEqual({
      qboOpeningRawMaterials: 60_000,
      qboOpeningWip: 25_000,
      qboOpeningFinishedGoods: 15_000,
    })
    // The three locked rows are untouched - same debit values they came in with.
    expect(plan.rows.find((r) => r.accountId === 'rawMaterials')?.debitMinor).toBe(50_000)
    expect(plan.rows.find((r) => r.accountId === 'wip')?.debitMinor).toBeNull()
    expect(plan.rows.find((r) => r.accountId === 'finishedGoods')?.debitMinor).toBe(20_000)
    // None of the three count as "filled" - they kept the count, not a provider figure.
    expect(plan.filledCount).toBe(0)
  })

  it('sums the provider-minus-count gap across the three roles, treating a null count as zero', () => {
    const rawMaterials = row({
      accountId: 'rawMaterials',
      lockedByRole: ACCOUNT_ROLES.INVENTORY_RAW_MATERIALS,
      debitMinor: 10_000,
    })
    const wip = row({
      accountId: 'wip',
      lockedByRole: ACCOUNT_ROLES.INVENTORY_WIP,
      debitMinor: null, // blank count
    })
    const finishedGoods = row({
      accountId: 'finishedGoods',
      lockedByRole: ACCOUNT_ROLES.INVENTORY_FINISHED_GOODS,
      debitMinor: 20_000,
    })

    const plan = planProviderOpeningFill({
      sheet: sheet([
        accountRow({ providerAccountId: 'p_raw', minorSigned: 15_000 }),
        accountRow({ providerAccountId: 'p_wip', minorSigned: 25_000 }),
        accountRow({ providerAccountId: 'p_fg', minorSigned: 15_000 }),
      ]),
      rows: [rawMaterials, wip, finishedGoods],
      accountMap: new Map([
        ['rawMaterials', 'p_raw'],
        ['wip', 'p_wip'],
        ['finishedGoods', 'p_fg'],
      ]),
      roleAccounts: new Map([
        [ACCOUNT_ROLES.INVENTORY_RAW_MATERIALS, 'rawMaterials'],
        [ACCOUNT_ROLES.INVENTORY_WIP, 'wip'],
        [ACCOUNT_ROLES.INVENTORY_FINISHED_GOODS, 'finishedGoods'],
      ]),
    })

    // (15000-10000) + (25000-0) + (15000-20000) = 5000 + 25000 - 5000 = 25000
    expect(plan.inventoryGapMinor).toBe(25_000)
  })

  it('refuses the qboOpening* fill and leaves all three figures null when the three roles share one account', () => {
    const sharedAccount = row({
      accountId: 'inventoryAsset',
      accountCode: '1310',
      accountName: 'Inventory Asset',
      lockedByRole: ACCOUNT_ROLES.INVENTORY_FINISHED_GOODS,
      debitMinor: 400_000,
    })

    const plan = planProviderOpeningFill({
      sheet: sheet([
        accountRow({
          providerAccountId: 'p_shared',
          name: 'Inventory Asset',
          minorSigned: 41_288_000,
        }),
      ]),
      rows: [sharedAccount],
      accountMap: new Map([['inventoryAsset', 'p_shared']]),
      roleAccounts: new Map([
        [ACCOUNT_ROLES.INVENTORY_RAW_MATERIALS, 'inventoryAsset'],
        [ACCOUNT_ROLES.INVENTORY_WIP, 'inventoryAsset'],
        [ACCOUNT_ROLES.INVENTORY_FINISHED_GOODS, 'inventoryAsset'],
      ]),
    })

    expect(plan.inventory).toEqual({
      qboOpeningRawMaterials: null,
      qboOpeningWip: null,
      qboOpeningFinishedGoods: null,
    })
    expect(plan.inventoryRefusal).toContain('Inventory Asset')
    expect(plan.inventoryRefusal).toContain('$412,880.00')
    // The locked row itself is untouched either way.
    expect(plan.rows[0]?.debitMinor).toBe(400_000)
    expect(plan.inventoryGapMinor).toBe(41_288_000 - 400_000)
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

  it('never lists a provider row that landed on an inventory-role account', () => {
    const rawMaterials = row({
      accountId: 'rawMaterials',
      lockedByRole: ACCOUNT_ROLES.INVENTORY_RAW_MATERIALS,
      debitMinor: 10_000,
    })

    const plan = planProviderOpeningFill({
      sheet: sheet([
        accountRow({ providerAccountId: 'p_raw', name: 'Inventory Asset', minorSigned: 15_000 }),
      ]),
      rows: [rawMaterials],
      accountMap: new Map([['rawMaterials', 'p_raw']]),
      roleAccounts: new Map([[ACCOUNT_ROLES.INVENTORY_RAW_MATERIALS, 'rawMaterials']]),
    })

    expect(plan.unmatched).toEqual([])
  })
})

describe('rowsToJournalEntryLines(plan.rows)', () => {
  it('includes the locked inventory rows at their count value - the section 4.3 trap: a plan that dropped them would store zero and Finalize would then refuse with the locked-row ConflictError', () => {
    const rawMaterials = row({
      accountId: 'rawMaterials',
      lockedByRole: ACCOUNT_ROLES.INVENTORY_RAW_MATERIALS,
      debitMinor: 50_000,
    })
    const checking = row({ accountId: 'checking' })

    const plan = planProviderOpeningFill({
      sheet: sheet([accountRow({ providerAccountId: 'p_checking', minorSigned: 20_000 })]),
      rows: [rawMaterials, checking],
      accountMap: new Map([['checking', 'p_checking']]),
      roleAccounts: new Map([[ACCOUNT_ROLES.INVENTORY_RAW_MATERIALS, 'rawMaterials']]),
    })

    const lines = rowsToJournalEntryLines(plan.rows)
    expect(lines).toEqual(
      expect.arrayContaining([
        { glAccountId: 'rawMaterials', direction: 'debit', amountMinor: 50_000 },
        { glAccountId: 'checking', direction: 'debit', amountMinor: 20_000 },
      ])
    )
  })
})
