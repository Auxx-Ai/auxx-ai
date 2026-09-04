// packages/lib/src/postings/reports/__tests__/balance-sheet.test.ts
//
// `readBalanceSheet` composes three `readTrialBalance` calls and one
// `loadRoleAccountCodes` lookup - both mocked here, so this file tests the
// roll-forward COMPOSITION (`04-reporting.md` §2's "single most common way a
// first balance sheet is wrong") in isolation from the SQL those two
// collaborators run, which is covered by `trial-balance.test.ts` and
// `resolve-roles.test.ts`.

import type { Database } from '@auxx/database'
import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ACCOUNT_ROLES } from '../../build-entry'
import type { TrialBalance, TrialBalanceRow } from '../trial-balance'

vi.mock('../trial-balance', () => ({ readTrialBalance: vi.fn() }))
vi.mock('../../resolve-roles', () => ({ loadRoleAccountCodes: vi.fn() }))
// The chart is read ONCE per balance sheet and handed to every trial-balance
// read, so this reader now touches `role-map` directly.
vi.mock('../../role-map', () => ({ listChartAccounts: vi.fn() }))

import { loadRoleAccountCodes } from '../../resolve-roles'
import { listChartAccounts } from '../../role-map'
import { readBalanceSheet } from '../balance-sheet'
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

/** Wires the three `readTrialBalance` calls `computeSnapshot` makes, keyed on which bound it asked for. */
function mockTrialBalances(params: {
  cumulative: TrialBalanceRow[]
  priorYears: TrialBalanceRow[]
  currentFy: TrialBalanceRow[]
}) {
  vi.mocked(readTrialBalance).mockImplementation(async (_db, options) => {
    if (options.from) return ok(tb(params.currentFy, options.to, options.from))
    // Two `to`-only calls happen: the cumulative asOf read, and the
    // day-before-fiscal-year-start read. Distinguish by whether `to` looks
    // like December 31 (the day before a Jan-1 fiscal year start) vs not.
    if (options.to.endsWith('-12-31')) return ok(tb(params.priorYears, options.to))
    return ok(tb(params.cumulative, options.to))
  })
}

/** `equity_retained_earnings` mapped to `3100`, the ordinary post-cutover org. */
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

describe('readBalanceSheet', () => {
  beforeEach(() => {
    vi.mocked(listChartAccounts).mockResolvedValue(ok([]))
  })

  it('balances when nothing has ever been posted to retained earnings (rolled forward)', async () => {
    vi.mocked(loadRoleAccountCodes).mockResolvedValue(new Map())
    mockTrialBalances({
      // As of the report date: cash 900,000 (asset), A/P 100,000 (liability),
      // owner's equity 50,000. Assets - Liabilities - Equity(posted) = 750,000
      // = the all-time net income this test expects to see rolled forward.
      cumulative: [
        row({
          accountCode: '1000',
          accountType: 'asset',
          debitMinor: 900_000,
          balanceMinor: 900_000,
        }),
        row({
          accountCode: '2000',
          accountType: 'liability',
          creditMinor: 100_000,
          balanceMinor: 100_000,
        }),
        row({
          accountCode: '3000',
          accountType: 'equity',
          creditMinor: 50_000,
          balanceMinor: 50_000,
        }),
      ],
      // Prior years: no retained-earnings posting, and $600,000 of prior net income.
      priorYears: [
        row({
          accountCode: '4000',
          accountType: 'revenue',
          creditMinor: 600_000,
          balanceMinor: 600_000,
        }),
      ],
      // Current fiscal year to date: $150,000 of net income.
      currentFy: [
        row({
          accountCode: '4000',
          accountType: 'revenue',
          creditMinor: 150_000,
          balanceMinor: 150_000,
        }),
      ],
    })

    const result = await readBalanceSheet(stubDb(), { organizationId: ORG, asOf: '2026-08-31' })
    const bs = result._unsafeUnwrap()

    expect(bs.retainedEarnings.priorYearsSource).toBe('rolled_forward')
    expect(bs.retainedEarnings.priorYearsMinor).toBe(600_000)
    expect(bs.retainedEarnings.currentPeriodMinor).toBe(150_000)
    expect(bs.totalAssetsMinor).toBe(900_000)
    expect(bs.totalLiabilitiesMinor).toBe(100_000)
    // Posted equity (50,000) + prior-years computed (600,000) + current computed (150,000).
    expect(bs.totalEquityMinor).toBe(800_000)
    expect(bs.verdict).toBe(true)
    expect(bs.totalAssetsMinor).toBe(bs.totalLiabilitiesMinor + bs.totalEquityMinor)
  })

  it('balances across a fiscal-year boundary the same way in year two', async () => {
    // Year two: the org has now accumulated a full prior year's net income
    // (150,000, from the case above) with STILL nothing posted to retained
    // earnings, plus 40,000 of year-two activity so far.
    vi.mocked(loadRoleAccountCodes).mockResolvedValue(new Map())
    mockTrialBalances({
      cumulative: [
        row({
          accountCode: '1000',
          accountType: 'asset',
          debitMinor: 940_000,
          balanceMinor: 940_000,
        }),
        row({
          accountCode: '2000',
          accountType: 'liability',
          creditMinor: 100_000,
          balanceMinor: 100_000,
        }),
        row({
          accountCode: '3000',
          accountType: 'equity',
          creditMinor: 50_000,
          balanceMinor: 50_000,
        }),
      ],
      priorYears: [
        row({
          accountCode: '4000',
          accountType: 'revenue',
          creditMinor: 750_000,
          balanceMinor: 750_000,
        }),
      ],
      currentFy: [
        row({
          accountCode: '4000',
          accountType: 'revenue',
          creditMinor: 40_000,
          balanceMinor: 40_000,
        }),
      ],
    })

    const result = await readBalanceSheet(stubDb(), { organizationId: ORG, asOf: '2027-03-15' })
    const bs = result._unsafeUnwrap()

    expect(bs.retainedEarnings.priorYearsMinor).toBe(750_000)
    expect(bs.retainedEarnings.currentPeriodMinor).toBe(40_000)
    expect(bs.verdict).toBe(true)
  })

  it('does not double-count the posted retained-earnings balance, which is already an equity row', async () => {
    // 🛑 Every fixture in this file is a real set of books: the `priorYears`
    // trial balance is cumulative-from-the-beginning through the day before the
    // fiscal year, and `cumulative` is cumulative through `asOf`, so the second
    // is necessarily a SUPERSET of the first. An earlier version of this case
    // had 999,000 of revenue in `priorYears` and none in `cumulative`, which no
    // ledger can produce - and it was that impossible fixture, not the code,
    // that made the `posted` branch look like it balanced.
    //
    // The books here: an opening entry dated 2025-12-31 (Dr cash 600,000 /
    // Cr A/P 100,000 / Cr retained earnings 500,000), then 100,000 of cash
    // sales in 2026.
    mockRetainedEarningsRole()
    mockTrialBalances({
      cumulative: [
        row({
          accountCode: '1000',
          accountType: 'asset',
          debitMinor: 700_000,
          balanceMinor: 700_000,
        }),
        row({
          accountCode: '2000',
          accountType: 'liability',
          creditMinor: 100_000,
          balanceMinor: 100_000,
        }),
        row({
          accountCode: '3100',
          accountType: 'equity',
          creditMinor: 500_000,
          balanceMinor: 500_000,
        }),
        row({
          accountCode: '4000',
          accountType: 'revenue',
          creditMinor: 100_000,
          balanceMinor: 100_000,
        }),
      ],
      priorYears: [
        row({
          accountCode: '1000',
          accountType: 'asset',
          debitMinor: 600_000,
          balanceMinor: 600_000,
        }),
        row({
          accountCode: '2000',
          accountType: 'liability',
          creditMinor: 100_000,
          balanceMinor: 100_000,
        }),
        row({
          accountCode: '3100',
          accountType: 'equity',
          creditMinor: 500_000,
          balanceMinor: 500_000,
        }),
      ],
      currentFy: [
        row({
          accountCode: '4000',
          accountType: 'revenue',
          creditMinor: 100_000,
          balanceMinor: 100_000,
        }),
      ],
    })

    const result = await readBalanceSheet(stubDb(), { organizationId: ORG, asOf: '2026-08-31' })
    const bs = result._unsafeUnwrap()

    expect(bs.retainedEarnings.priorYearsSource).toBe('posted')
    // The posted 500,000 is REPORTED, and it is not added again: it is already
    // the 3100 equity row.
    expect(bs.retainedEarnings.postedPriorYearsMinor).toBe(500_000)
    // No prior-period P&L exists in this org's books, so the roll-forward is 0.
    expect(bs.retainedEarnings.priorYearsMinor).toBe(0)
    expect(bs.retainedEarnings.currentPeriodMinor).toBe(100_000)
    // Posted equity (the 3100 row, 500,000) + 0 + current computed (100,000).
    expect(bs.totalEquityMinor).toBe(600_000)
    expect(bs.totalAssetsMinor).toBe(700_000)
    expect(bs.totalLiabilitiesMinor).toBe(100_000)
    expect(bs.verdict).toBe(true)
  })

  it('balances in year two with BOTH a posted opening retained-earnings balance and a full prior year of trading', async () => {
    // 🛑 The case the `posted` branch used to get wrong, by exactly one fiscal
    // year's net income. The org's books, end to end:
    //
    //   2025-12-31  opening entry: Dr 1000 600,000 / Cr 2000 100,000
    //                              / Cr 3100 500,000
    //   FY2026      300,000 of cash sales, 120,000 of cash expenses
    //   FY2027      40,000 of cash sales through 2027-06-30
    //
    // Nothing ever closes 2026's P&L into 3100 - this pass has no year-end
    // close - so 2026's 180,000 sits in 4000/5000 and the balance sheet has to
    // add it on top of the posted 500,000. Dropping it left equity at 540,000
    // against assets of 820,000, and the verdict read false.
    mockRetainedEarningsRole()
    mockTrialBalances({
      // Cumulative through 2027-06-30. Debits 940,000, credits 940,000.
      cumulative: [
        row({
          accountCode: '1000',
          accountType: 'asset',
          debitMinor: 820_000,
          balanceMinor: 820_000,
        }),
        row({
          accountCode: '2000',
          accountType: 'liability',
          creditMinor: 100_000,
          balanceMinor: 100_000,
        }),
        row({
          accountCode: '3100',
          accountType: 'equity',
          creditMinor: 500_000,
          balanceMinor: 500_000,
        }),
        row({
          accountCode: '4000',
          accountType: 'revenue',
          creditMinor: 340_000,
          balanceMinor: 340_000,
        }),
        row({
          accountCode: '5000',
          accountType: 'expense',
          debitMinor: 120_000,
          balanceMinor: 120_000,
        }),
      ],
      // Cumulative through 2026-12-31. Debits 900,000, credits 900,000.
      priorYears: [
        row({
          accountCode: '1000',
          accountType: 'asset',
          debitMinor: 780_000,
          balanceMinor: 780_000,
        }),
        row({
          accountCode: '2000',
          accountType: 'liability',
          creditMinor: 100_000,
          balanceMinor: 100_000,
        }),
        row({
          accountCode: '3100',
          accountType: 'equity',
          creditMinor: 500_000,
          balanceMinor: 500_000,
        }),
        row({
          accountCode: '4000',
          accountType: 'revenue',
          creditMinor: 300_000,
          balanceMinor: 300_000,
        }),
        row({
          accountCode: '5000',
          accountType: 'expense',
          debitMinor: 120_000,
          balanceMinor: 120_000,
        }),
      ],
      // 2027-01-01 through 2027-06-30.
      currentFy: [
        row({
          accountCode: '4000',
          accountType: 'revenue',
          creditMinor: 40_000,
          balanceMinor: 40_000,
        }),
      ],
    })

    const result = await readBalanceSheet(stubDb(), { organizationId: ORG, asOf: '2027-06-30' })
    const bs = result._unsafeUnwrap()

    expect(bs.retainedEarnings.priorYearsSource).toBe('posted')
    expect(bs.retainedEarnings.postedPriorYearsMinor).toBe(500_000)
    expect(bs.retainedEarnings.priorYearsMinor).toBe(180_000)
    expect(bs.retainedEarnings.currentPeriodMinor).toBe(40_000)
    // The whole story: 500,000 put in the account + 180,000 unclosed 2026 +
    // 40,000 of 2027 so far.
    expect(bs.retainedEarnings.balanceMinor).toBe(720_000)
    expect(bs.totalAssetsMinor).toBe(820_000)
    expect(bs.totalLiabilitiesMinor).toBe(100_000)
    // Posted equity (500,000) + 180,000 + 40,000. NOT 540,000.
    expect(bs.totalEquityMinor).toBe(720_000)
    expect(bs.verdict).toBe(true)
    expect(bs.totalAssetsMinor).toBe(bs.totalLiabilitiesMinor + bs.totalEquityMinor)
  })

  it('renders a contra asset as negative, never reclassified', async () => {
    vi.mocked(loadRoleAccountCodes).mockResolvedValue(new Map())
    mockTrialBalances({
      cumulative: [
        row({
          accountCode: '1100',
          accountType: 'asset',
          debitMinor: 200_000,
          balanceMinor: 200_000,
        }),
        // 1190: an ASSET with a natural CREDIT balance - trial-balance.ts
        // already signed this negative via `signedBalance`.
        row({
          accountCode: '1190',
          accountType: 'asset',
          creditMinor: 15_000,
          balanceMinor: -15_000,
        }),
      ],
      priorYears: [],
      currentFy: [],
    })

    const result = await readBalanceSheet(stubDb(), { organizationId: ORG, asOf: '2026-08-31' })
    const bs = result._unsafeUnwrap()

    const allowance = bs.assets.find((a) => a.accountCode === '1190')
    expect(allowance?.balanceMinor).toBe(-15_000)
    expect(bs.totalAssetsMinor).toBe(185_000)
  })

  it('computes a compare snapshot independently when compareAsOf is given', async () => {
    vi.mocked(loadRoleAccountCodes).mockResolvedValue(new Map())
    mockTrialBalances({
      cumulative: [
        row({
          accountCode: '1000',
          accountType: 'asset',
          debitMinor: 100_000,
          balanceMinor: 100_000,
        }),
      ],
      priorYears: [],
      currentFy: [],
    })

    const result = await readBalanceSheet(stubDb(), {
      organizationId: ORG,
      asOf: '2026-08-31',
      compareAsOf: '2026-07-31',
    })

    const bs = result._unsafeUnwrap()
    expect(bs.compare).not.toBeNull()
    expect(bs.compare?.asOf).toBe('2026-07-31')
  })
})

function stubDb(): Database {
  return {} as unknown as Database
}
