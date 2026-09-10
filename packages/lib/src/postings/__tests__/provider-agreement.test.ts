// packages/lib/src/postings/__tests__/provider-agreement.test.ts
//
// `planProviderAgreement` is pure - no database, no doubles - so every test
// here hands it hand-built provider rows and trial-balance rows and reads the
// comparison back. Sibling of `opening-fill-plan.test.ts`, same shape.
//
// The test that matters most is the last describe: our side is
// `debitMinor - creditMinor`, NEVER `TrialBalanceRow.balanceMinor`, which is
// natural-sign and would report a matching liability as double its balance.

import { describe, expect, it } from 'vitest'
import { UnprocessableEntityError } from '../../errors'
import { planProviderAgreement } from '../provider-agreement'
import { signedBalance } from '../reports/statement-math'
import type { TrialBalanceRow } from '../reports/trial-balance'
import type { ProviderBalanceRow } from '../types'

function ourRow(over: Partial<TrialBalanceRow> = {}): TrialBalanceRow {
  const base: TrialBalanceRow = {
    glAccountId: 'acc',
    accountCode: null,
    accountName: 'Account',
    accountType: 'asset',
    subtype: null,
    debitMinor: 0,
    creditMinor: 0,
    balanceMinor: 0,
    inChart: true,
    ...over,
  }
  // Keep the fixture honest: `balanceMinor` is whatever the real read would
  // have computed, so a test that accidentally used it would still pass on an
  // asset row and fail loudly on a liability one.
  return {
    ...base,
    balanceMinor: base.accountType
      ? signedBalance(base.debitMinor, base.creditMinor, base.accountType)
      : 0,
  }
}

function theirRow(over: Partial<ProviderBalanceRow> = {}): ProviderBalanceRow {
  return {
    providerAccountId: 'p1',
    name: 'Account',
    kind: 'account',
    minorSigned: 0,
    ...over,
  }
}

const ASOF = '2025-12-31'

function plan(input: {
  provider?: readonly ProviderBalanceRow[]
  ours?: readonly TrialBalanceRow[]
  accountMap?: ReadonlyMap<string, string>
  providerHasData?: boolean
}) {
  return planProviderAgreement({
    provider: input.provider ?? [],
    ours: input.ours ?? [],
    accountMap: input.accountMap ?? new Map(),
    asOf: ASOF,
    providerHasData: input.providerHasData ?? true,
  })
}

describe('a clean match', () => {
  it('reports zero difference and keeps the agreeing rows', () => {
    const result = plan({
      ours: [
        ourRow({
          glAccountId: 'checking',
          accountCode: '1000',
          accountName: 'Checking',
          debitMinor: 250_00,
        }),
        ourRow({
          glAccountId: 'ap',
          accountCode: '2000',
          accountName: 'Accounts Payable',
          accountType: 'liability',
          creditMinor: 90_00,
        }),
      ],
      accountMap: new Map([
        ['checking', 'p-checking'],
        ['ap', 'p-ap'],
      ]),
      provider: [
        theirRow({ providerAccountId: 'p-checking', name: 'Checking', minorSigned: 250_00 }),
        theirRow({ providerAccountId: 'p-ap', name: 'Accounts Payable', minorSigned: -90_00 }),
      ],
    })

    expect(result.isOk()).toBe(true)
    const agreement = result._unsafeUnwrap()
    expect(agreement.asOf).toBe(ASOF)
    expect(agreement.totalDifferenceMinor).toBe(0)
    expect(agreement.hasDifferences).toBe(false)
    expect(agreement.providerHasData).toBe(true)
    // `rows` carries the matching accounts too - a screen that only listed
    // differences could not tell "they agree" from "we read nothing".
    expect(agreement.rows).toHaveLength(2)
    expect(agreement.rows.every((row) => row.status === 'match')).toBe(true)
    expect(agreement.rows.map((row) => row.accountCode)).toEqual(['1000', '2000'])
  })
})

describe('a one-account difference', () => {
  it('names only the account that differs and totals it', () => {
    const result = plan({
      ours: [
        ourRow({
          glAccountId: 'checking',
          accountCode: '1000',
          accountName: 'Checking',
          debitMinor: 250_00,
        }),
        ourRow({
          glAccountId: 'prepaid',
          accountCode: '1400',
          accountName: 'Prepaid Insurance',
          debitMinor: 1_200_00,
        }),
      ],
      accountMap: new Map([
        ['checking', 'p-checking'],
        ['prepaid', 'p-prepaid'],
      ]),
      provider: [
        theirRow({ providerAccountId: 'p-checking', name: 'Checking', minorSigned: 250_00 }),
        // The accountant amortized a month in QuickBooks and we did not.
        theirRow({
          providerAccountId: 'p-prepaid',
          name: 'Prepaid Insurance',
          minorSigned: 1_100_00,
        }),
      ],
    })

    const agreement = result._unsafeUnwrap()
    expect(agreement.totalDifferenceMinor).toBe(100_00)
    expect(agreement.hasDifferences).toBe(true)

    const prepaid = agreement.rows.find((row) => row.glAccountId === 'prepaid')
    expect(prepaid).toMatchObject({
      status: 'differs',
      providerAccountId: 'p-prepaid',
      oursMinor: 1_200_00,
      theirsMinor: 1_100_00,
      differenceMinor: 100_00,
    })
    expect(agreement.rows.find((row) => row.glAccountId === 'checking')?.status).toBe('match')
  })
})

describe('a row only they have', () => {
  it('carries it as only_theirs with no account of ours', () => {
    const result = plan({
      ours: [
        ourRow({
          glAccountId: 'checking',
          accountCode: '1000',
          accountName: 'Checking',
          debitMinor: 250_00,
        }),
      ],
      accountMap: new Map([['checking', 'p-checking']]),
      provider: [
        theirRow({ providerAccountId: 'p-checking', name: 'Checking', minorSigned: 250_00 }),
        // Depreciation the firm authored, against an account we never mapped.
        theirRow({
          providerAccountId: 'p-accum-dep',
          name: 'Accumulated Depreciation',
          minorSigned: -4_000_00,
        }),
      ],
    })

    const agreement = result._unsafeUnwrap()
    const theirs = agreement.rows.find((row) => row.providerAccountId === 'p-accum-dep')
    expect(theirs).toMatchObject({
      glAccountId: null,
      accountCode: null,
      accountName: 'Accumulated Depreciation',
      status: 'only_theirs',
      oursMinor: 0,
      theirsMinor: -4_000_00,
      differenceMinor: 4_000_00,
    })
    expect(agreement.totalDifferenceMinor).toBe(4_000_00)
  })

  it('sums two report rows onto one provider account rather than keeping the last', () => {
    const result = plan({
      provider: [
        theirRow({ providerAccountId: 'p-x', name: 'Shared', minorSigned: 10_00 }),
        theirRow({ providerAccountId: 'p-x', name: 'Shared', minorSigned: 5_00 }),
      ],
    })

    const agreement = result._unsafeUnwrap()
    expect(agreement.rows).toHaveLength(1)
    expect(agreement.rows[0]?.theirsMinor).toBe(15_00)
  })

  it('excludes the computed net_income row, which carries no account', () => {
    const result = plan({
      provider: [
        theirRow({ providerAccountId: 'p-checking', name: 'Checking', minorSigned: 250_00 }),
        { providerAccountId: null, name: 'Net Income', kind: 'net_income', minorSigned: -99_00 },
      ],
    })

    const agreement = result._unsafeUnwrap()
    expect(agreement.rows).toHaveLength(1)
    expect(agreement.rows[0]?.providerAccountId).toBe('p-checking')
    expect(agreement.totalDifferenceMinor).toBe(250_00)
  })
})

describe('a row only we have', () => {
  it('carries an unmapped account of ours as only_ours', () => {
    const result = plan({
      ours: [
        ourRow({
          glAccountId: 'wip',
          accountCode: '1320',
          accountName: 'Work in Process',
          debitMinor: 3_000_00,
        }),
      ],
      provider: [],
    })

    const agreement = result._unsafeUnwrap()
    expect(agreement.rows).toHaveLength(1)
    expect(agreement.rows[0]).toMatchObject({
      glAccountId: 'wip',
      providerAccountId: null,
      accountCode: '1320',
      accountName: 'Work in Process',
      status: 'only_ours',
      oursMinor: 3_000_00,
      theirsMinor: 0,
      differenceMinor: 3_000_00,
    })
    expect(agreement.totalDifferenceMinor).toBe(3_000_00)
  })

  it('reads a mapped account the report omits as a difference, not as only_ours', () => {
    // The provider emits non-zero rows only, so a mapped account missing from
    // the report is a zero balance over there - a comparison that came out to
    // a difference, not an account they lack.
    const result = plan({
      ours: [
        ourRow({
          glAccountId: 'suspense',
          accountCode: '1999',
          accountName: 'Suspense',
          debitMinor: 42_00,
        }),
      ],
      accountMap: new Map([['suspense', 'p-suspense']]),
      provider: [],
    })

    expect(result._unsafeUnwrap().rows[0]).toMatchObject({
      status: 'differs',
      providerAccountId: 'p-suspense',
      theirsMinor: 0,
      differenceMinor: 42_00,
    })
  })
})

describe('a provider id claimed by two of our accounts', () => {
  it('refuses, naming both of our accounts and the provider id', () => {
    const result = plan({
      ours: [
        ourRow({
          glAccountId: 'raw',
          accountCode: '1310',
          accountName: 'Raw Materials',
          debitMinor: 1_000_00,
        }),
        ourRow({
          glAccountId: 'fg',
          accountCode: '1330',
          accountName: 'Finished Goods',
          debitMinor: 2_000_00,
        }),
      ],
      accountMap: new Map([
        ['raw', 'p-inventory'],
        ['fg', 'p-inventory'],
      ]),
      provider: [
        theirRow({ providerAccountId: 'p-inventory', name: 'Inventory', minorSigned: 3_000_00 }),
      ],
    })

    expect(result.isErr()).toBe(true)
    const error = result._unsafeUnwrapErr()
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(error.message).toContain('p-inventory')
    expect(error.message).toContain('1310 Raw Materials')
    expect(error.message).toContain('1330 Finished Goods')
  })

  it('falls back to the raw id for a claimant with no trial-balance row', () => {
    const result = plan({
      ours: [
        ourRow({
          glAccountId: 'raw',
          accountCode: '1310',
          accountName: 'Raw Materials',
          debitMinor: 1_000_00,
        }),
      ],
      accountMap: new Map([
        ['raw', 'p-inventory'],
        ['never-posted', 'p-inventory'],
      ]),
    })

    const error = result._unsafeUnwrapErr()
    expect(error.message).toContain('1310 Raw Materials')
    expect(error.message).toContain('never-posted')
  })
})

describe('an empty provider answer', () => {
  it('is ok with providerHasData false, never an error', () => {
    const result = plan({
      ours: [
        ourRow({
          glAccountId: 'checking',
          accountCode: '1000',
          accountName: 'Checking',
          debitMinor: 250_00,
        }),
      ],
      accountMap: new Map([['checking', 'p-checking']]),
      provider: [],
      providerHasData: false,
    })

    expect(result.isOk()).toBe(true)
    const agreement = result._unsafeUnwrap()
    expect(agreement.providerHasData).toBe(false)
    // An empty company must not be able to read as "everything agrees".
    expect(agreement.hasDifferences).toBe(true)
    expect(agreement.totalDifferenceMinor).toBe(250_00)
  })

  it('is ok with nothing on either side', () => {
    const agreement = plan({ providerHasData: false })._unsafeUnwrap()
    expect(agreement.rows).toEqual([])
    expect(agreement.totalDifferenceMinor).toBe(0)
    expect(agreement.hasDifferences).toBe(false)
    expect(agreement.providerHasData).toBe(false)
  })
})

describe('debit-positive on both sides', () => {
  // 🛑 The regression test. `TrialBalanceRow.balanceMinor` is NATURAL-sign, so
  // for a liability, equity or revenue account it is the exact negative of the
  // debit-positive number the provider sends. Using it would report every
  // agreeing credit-natured account as double its balance.
  it('agrees with the provider on a liability the two sides both credit', () => {
    const ap = ourRow({
      glAccountId: 'ap',
      accountCode: '2000',
      accountName: 'Accounts Payable',
      accountType: 'liability',
      debitMinor: 10_00,
      creditMinor: 1_510_00,
    })
    // The trap: natural-sign is +1500_00, debit-positive is -1500_00.
    expect(ap.balanceMinor).toBe(1_500_00)

    const agreement = plan({
      ours: [ap],
      accountMap: new Map([['ap', 'p-ap']]),
      provider: [
        theirRow({ providerAccountId: 'p-ap', name: 'Accounts Payable', minorSigned: -1_500_00 }),
      ],
    })._unsafeUnwrap()

    expect(agreement.rows[0]?.oursMinor).toBe(-1_500_00)
    expect(agreement.rows[0]?.theirsMinor).toBe(-1_500_00)
    expect(agreement.rows[0]?.differenceMinor).toBe(0)
    expect(agreement.rows[0]?.status).toBe('match')
    expect(agreement.totalDifferenceMinor).toBe(0)
  })

  it('agrees with the provider on a revenue account', () => {
    const sales = ourRow({
      glAccountId: 'sales',
      accountCode: '4000',
      accountName: 'Sales',
      accountType: 'revenue',
      creditMinor: 80_000_00,
    })
    expect(sales.balanceMinor).toBe(80_000_00)

    const agreement = plan({
      ours: [sales],
      accountMap: new Map([['sales', 'p-sales']]),
      provider: [
        theirRow({ providerAccountId: 'p-sales', name: 'Sales', minorSigned: -80_000_00 }),
      ],
    })._unsafeUnwrap()

    expect(agreement.rows[0]?.oursMinor).toBe(-80_000_00)
    expect(agreement.rows[0]?.differenceMinor).toBe(0)
    expect(agreement.hasDifferences).toBe(false)
  })

  it('still finds a real difference on a credit-natured account', () => {
    const equity = ourRow({
      glAccountId: 'equity',
      accountCode: '3000',
      accountName: 'Retained Earnings',
      accountType: 'equity',
      creditMinor: 5_000_00,
    })

    const agreement = plan({
      ours: [equity],
      accountMap: new Map([['equity', 'p-equity']]),
      provider: [
        theirRow({
          providerAccountId: 'p-equity',
          name: 'Retained Earnings',
          minorSigned: -4_400_00,
        }),
      ],
    })._unsafeUnwrap()

    expect(agreement.rows[0]?.differenceMinor).toBe(-600_00)
    expect(agreement.totalDifferenceMinor).toBe(600_00)
    expect(agreement.rows[0]?.status).toBe('differs')
  })
})

describe('the row order', () => {
  it('sorts by code then name, uncoded rows last', () => {
    const agreement = plan({
      ours: [
        ourRow({ glAccountId: 'b', accountCode: '2000', accountName: 'Bravo', debitMinor: 1 }),
        ourRow({ glAccountId: 'a', accountCode: '1000', accountName: 'Alpha', debitMinor: 1 }),
      ],
      provider: [theirRow({ providerAccountId: 'p-z', name: 'Zulu', minorSigned: 1 })],
    })._unsafeUnwrap()

    expect(agreement.rows.map((row) => row.accountName)).toEqual(['Alpha', 'Bravo', 'Zulu'])
  })
})
