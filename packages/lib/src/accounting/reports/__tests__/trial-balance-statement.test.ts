// packages/lib/src/accounting/reports/__tests__/trial-balance-statement.test.ts
//
// `readTrialBalanceStatement` composes three `readTrialBalance` calls the way
// `readBalanceSheet` does, so this file mocks the same collaborators and tests
// the COMPOSITION - above all the verdict, which is the whole point of the
// computed retained-earnings row (task 57 §5.4).

import type { Database } from '@auxx/database'
import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ACCOUNT_ROLES } from '../../ledger/builders/entry'
import type { TrialBalance, TrialBalanceRow } from '../trial-balance'

vi.mock('../trial-balance', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../trial-balance')>()),
  readTrialBalance: vi.fn(),
}))
vi.mock('../../ledger/roles/resolve-roles', () => ({ loadRoleAccountCodes: vi.fn() }))
vi.mock('../../ledger/roles/role-map', () => ({ listChartAccounts: vi.fn() }))
vi.mock('../fiscal-year-setting', () => ({
  resolveFiscalYearStartMonth: vi.fn(async () => 1),
}))

import { loadRoleAccountCodes } from '../../ledger/roles/resolve-roles'
import { listChartAccounts } from '../../ledger/roles/role-map'
import { resolveFiscalYearStartMonth } from '../fiscal-year-setting'
import { readTrialBalance } from '../trial-balance'
import { readTrialBalanceStatement } from '../trial-balance-statement'

const ORG = 'org_1'
const DB = {} as Database

function row(
  overrides: Partial<TrialBalanceRow> & {
    accountCode: string
    accountType: TrialBalanceRow['accountType']
  }
): TrialBalanceRow {
  return {
    glAccountId: `id_${overrides.accountCode}`,
    accountName: '',
    subtype: null,
    debitMinor: 0,
    creditMinor: 0,
    balanceMinor: 0,
    inChart: true,
    ...overrides,
  }
}

/** A debit-side row: `balanceMinor` follows the account's natural side. */
function debit(accountCode: string, accountType: 'asset' | 'expense', amount: number) {
  return row({ accountCode, accountType, debitMinor: amount, balanceMinor: amount })
}

/** A credit-side row. */
function credit(
  accountCode: string,
  accountType: 'liability' | 'equity' | 'revenue',
  amount: number
) {
  return row({ accountCode, accountType, creditMinor: amount, balanceMinor: amount })
}

function tb(rows: TrialBalanceRow[], to: string, from: string | null = null): TrialBalance {
  const totalDebitMinor = rows.reduce((s, r) => s + r.debitMinor, 0)
  const totalCreditMinor = rows.reduce((s, r) => s + r.creditMinor, 0)
  return {
    organizationId: ORG,
    from,
    to,
    rows,
    totalDebitMinor,
    totalCreditMinor,
    balanced: totalDebitMinor === totalCreditMinor,
  }
}

/** The three reads, keyed the same way `balance-sheet.test.ts` keys them. */
function mockTrialBalances(params: {
  cumulative: TrialBalanceRow[]
  priorYears: TrialBalanceRow[]
  currentFy: TrialBalanceRow[]
}) {
  vi.mocked(readTrialBalance).mockImplementation(async (_db, options) => {
    if (options.from) return ok(tb(params.currentFy, options.to, options.from))
    if (options.to.endsWith('-12-31')) return ok(tb(params.priorYears, options.to))
    return ok(tb(params.cumulative, options.to))
  })
}

function mockRetainedEarningsRole() {
  vi.mocked(loadRoleAccountCodes).mockResolvedValue(
    new Map([
      [
        ACCOUNT_ROLES.EQUITY_RETAINED_EARNINGS,
        {
          glAccountId: 'id_3100',
          code: '3100',
          name: 'Retained Earnings',
          accountType: 'equity',
          isActive: true,
        },
      ],
    ])
  )
}

describe('readTrialBalanceStatement', () => {
  beforeEach(() => {
    vi.mocked(listChartAccounts).mockResolvedValue(ok([]))
    vi.mocked(loadRoleAccountCodes).mockResolvedValue(new Map())
    vi.mocked(resolveFiscalYearStartMonth).mockResolvedValue(1)
  })

  // 🛑 THE test. Resetting P&L accounts at the fiscal year removes prior-year
  // debits and credits in unequal amounts, and only a plug of exactly
  // `priorYearsMinor` puts the statement back in balance. A plug of
  // `retainedEarnings().balanceMinor` would also add the current period's net
  // income, which is still on the report as its own rows - this fails then.
  it('balances after the fiscal-year reset, with a profitable prior year', async () => {
    mockTrialBalances({
      // Cash 900,000 debit; A/P 100,000 credit; owner equity 50,000 credit.
      cumulative: [
        debit('1000', 'asset', 900_000),
        credit('2000', 'liability', 100_000),
        credit('3000', 'equity', 50_000),
      ],
      // Prior years made 600,000: revenue 1,000,000 less expense 400,000.
      priorYears: [credit('4000', 'revenue', 1_000_000), debit('5000', 'expense', 400_000)],
      // This year so far: revenue 250,000 less expense 100,000 = 150,000.
      currentFy: [credit('4000', 'revenue', 250_000), debit('5000', 'expense', 100_000)],
    })

    const result = await readTrialBalanceStatement(DB, { organizationId: ORG, asOf: '2026-09-16' })

    const statement = result._unsafeUnwrap()
    expect(statement.balanced).toBe(true)
    expect(statement.fiscalYearStart).toBe('2026-01-01')
    // The plug is prior-year net income as a CREDIT, and nothing else.
    expect(statement.retainedEarnings.priorYearsMinor).toBe(600_000)
    expect(statement.retainedEarnings.plugCreditMinor).toBe(600_000)
    expect(statement.retainedEarnings.plugDebitMinor).toBe(0)
    // 900,000 + 100,000 (expense) = 1,000,000 debit;
    // 100,000 + 50,000 + 250,000 + 600,000 = 1,000,000 credit.
    expect(statement.totalDebitMinor).toBe(1_000_000)
    expect(statement.totalCreditMinor).toBe(1_000_000)
  })

  it('puts the plug on the DEBIT side when prior years lost money', async () => {
    mockTrialBalances({
      cumulative: [debit('1000', 'asset', 200_000), credit('3000', 'equity', 500_000)],
      // Prior years lost 300,000.
      priorYears: [credit('4000', 'revenue', 100_000), debit('5000', 'expense', 400_000)],
      currentFy: [],
    })

    const statement = (
      await readTrialBalanceStatement(DB, { organizationId: ORG, asOf: '2026-09-16' })
    )._unsafeUnwrap()

    expect(statement.retainedEarnings.priorYearsMinor).toBe(-300_000)
    expect(statement.retainedEarnings.plugDebitMinor).toBe(300_000)
    expect(statement.retainedEarnings.plugCreditMinor).toBe(0)
    expect(statement.balanced).toBe(true)
  })

  it('emits no plug in year one, and reads exactly as the cumulative report did', async () => {
    const currentFy = [credit('4000', 'revenue', 300_000), debit('5000', 'expense', 100_000)]
    mockTrialBalances({
      cumulative: [debit('1000', 'asset', 200_000), ...currentFy],
      priorYears: [],
      currentFy,
    })

    const statement = (
      await readTrialBalanceStatement(DB, { organizationId: ORG, asOf: '2026-09-16' })
    )._unsafeUnwrap()

    expect(statement.retainedEarnings.priorYearsMinor).toBe(0)
    expect(statement.retainedEarnings.plugCreditMinor).toBe(0)
    expect(statement.retainedEarnings.plugDebitMinor).toBe(0)
    expect(statement.balanced).toBe(true)
    expect(statement.totalDebitMinor).toBe(300_000)
    expect(statement.totalCreditMinor).toBe(300_000)
  })

  // 🛑 The posted balance is already one of the cumulative equity ROWS, so it
  // must not also enter the plug. `priorYearsSource` flips to `posted` and the
  // arithmetic does not move - the same contract `statement-math.ts` documents.
  it('does not double-count a posted retained-earnings balance', async () => {
    mockRetainedEarningsRole()
    mockTrialBalances({
      cumulative: [
        debit('1000', 'asset', 900_000),
        credit('3000', 'equity', 50_000),
        credit('3100', 'equity', 250_000),
      ],
      priorYears: [
        credit('3100', 'equity', 250_000),
        credit('4000', 'revenue', 1_000_000),
        debit('5000', 'expense', 400_000),
      ],
      currentFy: [credit('4000', 'revenue', 100_000), debit('5000', 'expense', 100_000)],
    })

    const statement = (
      await readTrialBalanceStatement(DB, { organizationId: ORG, asOf: '2026-09-16' })
    )._unsafeUnwrap()

    expect(statement.retainedEarnings.priorYearsSource).toBe('posted')
    expect(statement.retainedEarnings.postedPriorYearsMinor).toBe(250_000)
    // The plug is still prior-year NET INCOME alone - 250,000 is not in it.
    expect(statement.retainedEarnings.plugCreditMinor).toBe(600_000)
    expect(statement.balanced).toBe(true)
  })

  it('scopes revenue and expense to the current fiscal year, and nothing else', async () => {
    mockTrialBalances({
      cumulative: [
        debit('1000', 'asset', 900_000),
        credit('4000', 'revenue', 1_250_000),
        debit('5000', 'expense', 500_000),
      ],
      priorYears: [credit('4000', 'revenue', 1_000_000), debit('5000', 'expense', 400_000)],
      currentFy: [credit('4000', 'revenue', 250_000), debit('5000', 'expense', 100_000)],
    })

    const statement = (
      await readTrialBalanceStatement(DB, { organizationId: ORG, asOf: '2026-09-16' })
    )._unsafeUnwrap()

    const revenue = statement.rows.find((r) => r.accountCode === '4000')
    const asset = statement.rows.find((r) => r.accountCode === '1000')
    // The revenue row is THIS YEAR, not the 1,250,000 life-to-date figure.
    expect(revenue?.creditMinor).toBe(250_000)
    // The asset row is untouched by the boundary.
    expect(asset?.debitMinor).toBe(900_000)
  })

  it('honours a non-January fiscal year when drawing the boundary', async () => {
    vi.mocked(resolveFiscalYearStartMonth).mockResolvedValue(7)
    vi.mocked(readTrialBalance).mockResolvedValue(ok(tb([], '2026-09-16')))

    const statement = (
      await readTrialBalanceStatement(DB, { organizationId: ORG, asOf: '2026-09-16' })
    )._unsafeUnwrap()

    expect(statement.fiscalYearStart).toBe('2026-07-01')
    // The prior-years read stops the day before the fiscal year opens.
    expect(vi.mocked(readTrialBalance)).toHaveBeenCalledWith(
      DB,
      expect.objectContaining({ to: '2026-06-30' })
    )
    expect(vi.mocked(readTrialBalance)).toHaveBeenCalledWith(
      DB,
      expect.objectContaining({ from: '2026-07-01', to: '2026-09-16' })
    )
    // Only the cumulative read nets receivables per document (91 D3).
    expect(vi.mocked(readTrialBalance)).toHaveBeenCalledWith(
      DB,
      expect.objectContaining({ to: '2026-09-16', splitReceivables: true })
    )
    expect(
      vi.mocked(readTrialBalance).mock.calls.filter(([, options]) => options.splitReceivables)
    ).toHaveLength(1)
  })

  it('keeps a deleted account cumulative - it has no statement class to scope by', async () => {
    const deleted: TrialBalanceRow = {
      glAccountId: 'id_gone',
      accountCode: '9999',
      accountName: '',
      accountType: null,
      subtype: null,
      debitMinor: 70_000,
      creditMinor: 0,
      balanceMinor: 0,
      inChart: false,
    }
    mockTrialBalances({
      cumulative: [debit('1000', 'asset', 30_000), credit('2000', 'liability', 100_000), deleted],
      priorYears: [],
      currentFy: [],
    })

    const statement = (
      await readTrialBalanceStatement(DB, { organizationId: ORG, asOf: '2026-09-16' })
    )._unsafeUnwrap()

    expect(statement.rows.find((r) => r.accountCode === '9999')?.debitMinor).toBe(70_000)
    expect(statement.balanced).toBe(true)
  })
})
