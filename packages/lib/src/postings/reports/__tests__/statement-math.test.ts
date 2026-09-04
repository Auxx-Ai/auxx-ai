// packages/lib/src/postings/reports/__tests__/statement-math.test.ts
//
// Exhaustive over the five statement classifications: natural-balance signing
// must never reclassify a contra account, and the retained-earnings
// roll-forward must hold across a fiscal-year boundary either way it is fed.

import { describe, expect, it } from 'vitest'
import { UnprocessableEntityError } from '../../../errors'
import type { GlAccountTypeValue } from '../../default-chart'
import {
  NATURAL_BALANCE_DIRECTION,
  netIncome,
  retainedEarnings,
  signedBalance,
} from '../statement-math'

describe('NATURAL_BALANCE_DIRECTION', () => {
  it('is debit for asset and expense, credit for liability, equity and revenue', () => {
    expect(NATURAL_BALANCE_DIRECTION.asset).toBe('debit')
    expect(NATURAL_BALANCE_DIRECTION.expense).toBe('debit')
    expect(NATURAL_BALANCE_DIRECTION.liability).toBe('credit')
    expect(NATURAL_BALANCE_DIRECTION.equity).toBe('credit')
    expect(NATURAL_BALANCE_DIRECTION.revenue).toBe('credit')
  })
})

describe('signedBalance', () => {
  const cases: Array<{
    accountType: GlAccountTypeValue
    debit: number
    credit: number
    expected: number
  }> = [
    { accountType: 'asset', debit: 1000, credit: 200, expected: 800 },
    { accountType: 'asset', debit: 200, credit: 1000, expected: -800 },
    { accountType: 'expense', debit: 500, credit: 0, expected: 500 },
    { accountType: 'expense', debit: 0, credit: 500, expected: -500 },
    { accountType: 'liability', debit: 100, credit: 900, expected: 800 },
    { accountType: 'liability', debit: 900, credit: 100, expected: -800 },
    { accountType: 'equity', debit: 0, credit: 5000, expected: 5000 },
    { accountType: 'revenue', debit: 0, credit: 10_000, expected: 10_000 },
    { accountType: 'revenue', debit: 100, credit: 0, expected: -100 },
  ]

  for (const { accountType, debit, credit, expected } of cases) {
    it(`${accountType}: debit ${debit}, credit ${credit} -> ${expected}`, () => {
      expect(signedBalance(debit, credit, accountType)).toBe(expected)
    })
  }

  it('renders 1190 (an ASSET with a natural credit balance) as a negative asset - never reclassified', () => {
    // The chart's own comment: contra is a presentation attribute, never a
    // posting rule. Signing by the DECLARED type (asset, debit-natural) rather
    // than by whichever side is bigger is what keeps that true.
    const allowanceForDoubtfulAccounts = signedBalance(0, 15_000, 'asset')
    expect(allowanceForDoubtfulAccounts).toBe(-15_000)
  })

  it('is zero when debit equals credit, on every account type', () => {
    for (const accountType of ['asset', 'liability', 'equity', 'revenue', 'expense'] as const) {
      expect(signedBalance(500, 500, accountType)).toBe(0)
    }
  })

  it('throws on a non-integer sum', () => {
    expect(() => signedBalance(100.5, 0, 'asset')).toThrow(UnprocessableEntityError)
    expect(() => signedBalance(0, Number.NaN, 'asset')).toThrow(UnprocessableEntityError)
  })
})

describe('netIncome', () => {
  it('is revenue minus expense', () => {
    expect(
      netIncome([
        { accountType: 'revenue', balanceMinor: 100_000 },
        { accountType: 'revenue', balanceMinor: 5_000 },
        { accountType: 'expense', balanceMinor: 30_000 },
      ])
    ).toBe(75_000)
  })

  it('can be negative - a loss', () => {
    expect(
      netIncome([
        { accountType: 'revenue', balanceMinor: 1_000 },
        { accountType: 'expense', balanceMinor: 5_000 },
      ])
    ).toBe(-4_000)
  })

  it('is zero over no rows', () => {
    expect(netIncome([])).toBe(0)
  })

  it('throws on a row whose accountType is neither revenue nor expense', () => {
    expect(() =>
      netIncome([{ accountType: 'asset' as unknown as 'revenue', balanceMinor: 100 }])
    ).toThrow(UnprocessableEntityError)
  })

  it('throws on a non-integer balance', () => {
    expect(() => netIncome([{ accountType: 'revenue', balanceMinor: 1.5 }])).toThrow(
      UnprocessableEntityError
    )
  })
})

describe('retainedEarnings', () => {
  it('is prior-period retained earnings plus current-period net income, when nothing is posted', () => {
    // 04-reporting.md §2: "the single most common way a first balance sheet is
    // wrong" - nothing posts to retained earnings during the year, so this is
    // the roll-forward that keeps the sheet balancing.
    const re = retainedEarnings({
      priorYearsNetIncome: 200_000,
      currentPeriodNetIncome: 50_000,
      postedRetainedEarningsBalance: null,
    })
    expect(re).toEqual({
      balanceMinor: 250_000,
      priorYearsSource: 'rolled_forward',
      priorYearsMinor: 200_000,
      postedPriorYearsMinor: 0,
      currentPeriodMinor: 50_000,
    })
  })

  it('reports the posted balance separately from the roll-forward, and labels the source', () => {
    // A person has already put a real number in the role account (an opening
    // entry, a manual sweep). It comes back as `postedPriorYearsMinor`, which
    // the balance sheet must NOT add - it is already an equity account row.
    const re = retainedEarnings({
      priorYearsNetIncome: 0,
      currentPeriodNetIncome: 40_000,
      postedRetainedEarningsBalance: 500_000,
    })
    expect(re).toEqual({
      balanceMinor: 540_000,
      priorYearsSource: 'posted',
      priorYearsMinor: 0,
      postedPriorYearsMinor: 500_000,
      currentPeriodMinor: 40_000,
    })
  })

  it('a posted balance never suppresses unclosed prior-year net income - both are added', () => {
    // The bug this replaces: `postedRetainedEarningsBalance` used to make
    // `priorYearsNetIncome` disappear, on the reasoning that the account
    // already embodied it. Only a year-end close makes that true, and this
    // pass has none - so an org in its second fiscal year with a posted
    // opening balance lost exactly one year's net income off its equity.
    const re = retainedEarnings({
      priorYearsNetIncome: 180_000,
      currentPeriodNetIncome: 40_000,
      postedRetainedEarningsBalance: 500_000,
    })
    expect(re.priorYearsMinor).toBe(180_000)
    expect(re.postedPriorYearsMinor).toBe(500_000)
    expect(re.balanceMinor).toBe(720_000)
    expect(re.priorYearsSource).toBe('posted')
  })

  it('rolls forward across a fiscal-year boundary: year 2 sees year 1 as prior, not zero', () => {
    // Year 1: $120,000 net income, never swept to retained earnings.
    const year1 = retainedEarnings({
      priorYearsNetIncome: 0,
      currentPeriodNetIncome: 120_000,
      postedRetainedEarningsBalance: null,
    })
    expect(year1.balanceMinor).toBe(120_000)

    // Year 2, partway through: prior years is now what year 1 actually earned
    // (still nothing posted to the role account), plus year 2's own activity.
    const year2 = retainedEarnings({
      priorYearsNetIncome: 120_000,
      currentPeriodNetIncome: 30_000,
      postedRetainedEarningsBalance: null,
    })
    expect(year2).toEqual({
      balanceMinor: 150_000,
      priorYearsSource: 'rolled_forward',
      priorYearsMinor: 120_000,
      postedPriorYearsMinor: 0,
      currentPeriodMinor: 30_000,
    })
  })

  it('a loss year rolls forward as a negative prior balance', () => {
    const re = retainedEarnings({
      priorYearsNetIncome: -10_000,
      currentPeriodNetIncome: 4_000,
      postedRetainedEarningsBalance: null,
    })
    expect(re.balanceMinor).toBe(-6_000)
  })

  it('throws on a non-integer input', () => {
    expect(() =>
      retainedEarnings({
        priorYearsNetIncome: 1.1,
        currentPeriodNetIncome: 0,
        postedRetainedEarningsBalance: null,
      })
    ).toThrow(UnprocessableEntityError)
  })
})
