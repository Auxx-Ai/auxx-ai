// packages/lib/src/postings/reports/__tests__/profit-and-loss.test.ts
//
// `readProfitAndLoss` is a thin presentation split (revenue / COGS / operating
// expense) over one `readTrialBalance` call, which is mocked here - its SQL is
// covered by `trial-balance.test.ts`.

import type { Database } from '@auxx/database'
import { ok } from 'neverthrow'
import { describe, expect, it, vi } from 'vitest'
import type { TrialBalance, TrialBalanceRow } from '../trial-balance'

vi.mock('../trial-balance', () => ({ readTrialBalance: vi.fn() }))

import { readProfitAndLoss } from '../profit-and-loss'
import { readTrialBalance } from '../trial-balance'

const ORG = 'org_1'

function row(overrides: Partial<TrialBalanceRow> & { accountCode: string }): TrialBalanceRow {
  return {
    accountName: '',
    accountType: 'revenue',
    debitMinor: 0,
    creditMinor: 0,
    balanceMinor: 0,
    inChart: true,
    ...overrides,
  }
}

function tb(rows: TrialBalanceRow[], from: string, to: string): TrialBalance {
  const totalDebitMinor = rows.reduce((s, r) => s + r.debitMinor, 0)
  const totalCreditMinor = rows.reduce((s, r) => s + r.creditMinor, 0)
  return { organizationId: ORG, from, to, rows, totalDebitMinor, totalCreditMinor, balanced: true }
}

function stubDb(): Database {
  return {} as unknown as Database
}

describe('readProfitAndLoss', () => {
  it('groups 5xxx expense codes under cost of goods sold and everything else under operating expense', async () => {
    vi.mocked(readTrialBalance).mockResolvedValue(
      ok(
        tb(
          [
            row({
              accountCode: '4000',
              accountType: 'revenue',
              creditMinor: 500_000,
              balanceMinor: 500_000,
            }),
            row({
              accountCode: '5000',
              accountType: 'expense',
              debitMinor: 200_000,
              balanceMinor: 200_000,
            }),
            row({
              accountCode: '6100',
              accountType: 'expense',
              debitMinor: 50_000,
              balanceMinor: 50_000,
            }),
          ],
          '2026-08-01',
          '2026-08-31'
        )
      )
    )

    const result = await readProfitAndLoss(stubDb(), {
      organizationId: ORG,
      from: '2026-08-01',
      to: '2026-08-31',
    })
    const pl = result._unsafeUnwrap()

    expect(pl.cogs.map((r) => r.accountCode)).toEqual(['5000'])
    expect(pl.operatingExpenses.map((r) => r.accountCode)).toEqual(['6100'])
    expect(pl.totalRevenueMinor).toBe(500_000)
    expect(pl.totalCogsMinor).toBe(200_000)
    expect(pl.grossProfitMinor).toBe(300_000)
    expect(pl.totalOperatingExpensesMinor).toBe(50_000)
    expect(pl.totalExpenseMinor).toBe(250_000)
    expect(pl.netIncomeMinor).toBe(250_000)
  })

  it('net income equals revenue minus total expense, matching netIncome() over the same rows', async () => {
    vi.mocked(readTrialBalance).mockResolvedValue(
      ok(
        tb(
          [
            row({
              accountCode: '4000',
              accountType: 'revenue',
              creditMinor: 100_000,
              balanceMinor: 100_000,
            }),
            row({
              accountCode: '5090',
              accountType: 'expense',
              debitMinor: 10_000,
              balanceMinor: 10_000,
            }),
            row({
              accountCode: '6200',
              accountType: 'expense',
              debitMinor: 20_000,
              balanceMinor: 20_000,
            }),
          ],
          '2026-01-01',
          '2026-12-31'
        )
      )
    )

    const result = await readProfitAndLoss(stubDb(), {
      organizationId: ORG,
      from: '2026-01-01',
      to: '2026-12-31',
    })
    const pl = result._unsafeUnwrap()

    expect(pl.netIncomeMinor).toBe(70_000)
    expect(pl.netIncomeMinor).toBe(pl.grossProfitMinor - pl.totalOperatingExpensesMinor)
  })

  it('computes an independent compare snapshot when given', async () => {
    vi.mocked(readTrialBalance)
      .mockResolvedValueOnce(
        ok(
          tb(
            [
              row({
                accountCode: '4000',
                accountType: 'revenue',
                creditMinor: 10_000,
                balanceMinor: 10_000,
              }),
            ],
            '2026-08-01',
            '2026-08-31'
          )
        )
      )
      .mockResolvedValueOnce(
        ok(
          tb(
            [
              row({
                accountCode: '4000',
                accountType: 'revenue',
                creditMinor: 8_000,
                balanceMinor: 8_000,
              }),
            ],
            '2026-07-01',
            '2026-07-31'
          )
        )
      )

    const result = await readProfitAndLoss(stubDb(), {
      organizationId: ORG,
      from: '2026-08-01',
      to: '2026-08-31',
      compare: { from: '2026-07-01', to: '2026-07-31' },
    })

    const pl = result._unsafeUnwrap()
    expect(pl.totalRevenueMinor).toBe(10_000)
    expect(pl.compare?.totalRevenueMinor).toBe(8_000)
  })

  it('is zero-everything over a period with no activity', async () => {
    vi.mocked(readTrialBalance).mockResolvedValue(ok(tb([], '2026-08-01', '2026-08-31')))

    const result = await readProfitAndLoss(stubDb(), {
      organizationId: ORG,
      from: '2026-08-01',
      to: '2026-08-31',
    })
    const pl = result._unsafeUnwrap()

    expect(pl.totalRevenueMinor).toBe(0)
    expect(pl.grossProfitMinor).toBe(0)
    expect(pl.netIncomeMinor).toBe(0)
  })
})
