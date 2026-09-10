// packages/lib/src/postings/provider-sync/__tests__/provider-sync-plan.test.ts
//
// The structural facts the spike established (§4.2 to §4.7), asserted against
// the planner rather than against the apps-repo mapper: one row is one LINE,
// an unbalanced entry is never a write candidate, an unmapped provider account
// is a refusal naming it, and a provider id claimed by two of our accounts is a
// refusal naming both.

import { describe, expect, it } from 'vitest'
import { UnprocessableEntityError } from '../../../errors'
import {
  groupProviderLedgerEntries,
  invertAccountMap,
  planProviderSync,
  resolveProviderSyncLines,
} from '../plan'
import {
  accountMap,
  balancedEntryLines,
  ledger,
  line,
  ourEntry,
  sandboxShapedLedger,
} from './support/fixtures'

describe('grouping', () => {
  it('🛑 folds a sandbox-shaped 336 ROWS into 128 balanced ENTRIES', () => {
    // One row is one journal LINE (§4.4). A sync that wrote one posting per row
    // would produce 336 single-sided postings instead of 128 balanced entries.
    const fixture = sandboxShapedLedger()
    expect(fixture.lines).toHaveLength(336)

    const entries = groupProviderLedgerEntries(fixture.lines)

    expect(entries).toHaveLength(128)
    expect(entries.filter((entry) => !entry.balanced)).toHaveLength(0)
    expect(new Set(entries.map((entry) => entry.txnId)).size).toBe(128)
  })

  it('🛑 KEEPS zero-money rows - dropping them deletes four whole transactions', () => {
    // §4.7 suggests dropping them and it is wrong: nine of the sandbox's rows
    // carry no money in either column, and four transactions are made ENTIRELY
    // of them (the Inventory Qty Adjust opening rows). Dropping the rows yields
    // 124 entries instead of 128.
    const fixture = sandboxShapedLedger()
    const zeroRows = fixture.lines.filter((row) => row.debitMinor === 0 && row.creditMinor === 0)
    expect(zeroRows).toHaveLength(9)

    const entries = groupProviderLedgerEntries(fixture.lines)
    const zeroValueEntries = entries.filter(
      (entry) => entry.totalDebitMinor === 0 && entry.totalCreditMinor === 0
    )
    expect(zeroValueEntries).toHaveLength(4)
    expect(zeroValueEntries.every((entry) => entry.txnType === 'Inventory Qty Adjust')).toBe(true)
  })

  it('groups on the PAIR, so two types sharing an id stay two entries', () => {
    const entries = groupProviderLedgerEntries([
      ...balancedEntryLines({ txnType: 'Journal Entry', txnId: '6', amount: 100 }),
      ...balancedEntryLines({ txnType: 'Check', txnId: '6', amount: 200 }),
    ])
    expect(entries).toHaveLength(2)
    expect(entries.map((entry) => entry.totalDebitMinor)).toEqual([100, 200])
  })

  it('takes the first non-null document number an entry renders', () => {
    const [entry] = groupProviderLedgerEntries([
      line({ txnId: '7', debitMinor: 500, docNumber: null }),
      line({ txnId: '7', creditMinor: 500, docNumber: 'AUXX-FUL-202601' }),
    ])
    expect(entry?.docNumber).toBe('AUXX-FUL-202601')
  })

  it('⚠️ drops a row carrying no transaction id, and it never reaches `theirs`', () => {
    // A "Beginning Balance" row typically carries no id, and there is nothing
    // to group one on - the alternative to dropping it is inventing a key,
    // which mints an entry the provider does not have. The apps mapper already
    // skips these; this is the second line of defence.
    // 🔴 Unverified against a real mid-range call: the saved fixture starts in
    // 2015, before all of the company's data, so it renders none.
    const plan = planProviderSync({
      ledger: ledger([
        line({ txnType: 'Beginning Balance', txnId: '', debitMinor: 500000 }),
        line({ txnType: '', txnId: '', creditMinor: 500000 }),
        ...balancedEntryLines({ txnType: 'Deposit', txnId: '12', amount: 100 }),
      ]),
      ourProviderEntryIds: new Set(),
      ourEntries: [],
      accountMap: accountMap(),
    })

    const value = plan._unsafeUnwrap()
    expect(value.theirs.map((entry) => entry.txnId)).toEqual(['12'])
    expect(value.unbalanced).toHaveLength(0)
  })
})

describe('an unbalanced entry', () => {
  it('🛑 lands in `unbalanced`, never in `theirs`', () => {
    // An unbalanced entry in the ledger is worse than a missing one: it breaks
    // every statement that ties and gives the reader no way to find out why.
    const plan = planProviderSync({
      ledger: ledger([
        line({ txnType: 'Check', txnId: '20', debitMinor: 90000 }),
        line({ txnType: 'Check', txnId: '20', creditMinor: 80000 }),
        ...balancedEntryLines({ txnType: 'Deposit', txnId: '21', amount: 100 }),
      ]),
      ourProviderEntryIds: new Set(),
      ourEntries: [],
      accountMap: accountMap(),
    })

    const value = plan._unsafeUnwrap()
    expect(value.unbalanced.map((entry) => entry.txnId)).toEqual(['20'])
    expect(value.theirs.map((entry) => entry.txnId)).toEqual(['21'])
  })
})

describe('the account map', () => {
  it('🛑 refuses a provider id claimed by TWO of our accounts, naming both', () => {
    // Nothing in the schema enforces one-to-one: `setQuickbooksAccountMapping`
    // writes one cell and never checks. A guess here posts the accountant's
    // real entry into the wrong account, balanced, undetectably.
    const doubled = new Map([
      ['gl_checking', '35'],
      ['gl_savings', '35'],
    ])
    const labels = new Map([
      ['gl_checking', '1010 Checking'],
      ['gl_savings', '1020 Savings'],
    ])

    const refused = invertAccountMap(doubled, labels)
    expect(refused.isErr()).toBe(true)
    const error = refused._unsafeUnwrapErr()
    expect(error).toBeInstanceOf(UnprocessableEntityError)
    expect(error.message).toContain('1010 Checking')
    expect(error.message).toContain('1020 Savings')
    expect(error.message).toContain("'35'")
  })

  it('refuses the whole plan on a double claim, rather than planning most of it', () => {
    const plan = planProviderSync({
      ledger: ledger(balancedEntryLines({ txnType: 'Deposit', txnId: '1', amount: 100 })),
      ourProviderEntryIds: new Set(),
      ourEntries: [
        ourEntry({
          lines: [
            {
              glAccountId: 'gl_checking',
              accountCode: '1010',
              accountName: 'Checking',
              direction: 'debit',
              amountMinor: 100,
            },
            {
              glAccountId: 'gl_savings',
              accountCode: '1020',
              accountName: 'Savings',
              direction: 'credit',
              amountMinor: 100,
            },
          ],
        }),
      ],
      accountMap: new Map([
        ['gl_checking', '35'],
        ['gl_savings', '35'],
      ]),
    })

    expect(plan.isErr()).toBe(true)
    // Named through the snapshots on our own lines, not as raw cuids.
    expect(plan._unsafeUnwrapErr().message).toContain('1020 Savings')
  })

  it('inverts a clean map', () => {
    const inverted = invertAccountMap(accountMap())._unsafeUnwrap()
    expect(inverted.get('41')).toBe('gl_mastercard')
    expect(inverted.get('35')).toBe('gl_checking')
  })
})

describe('resolving one of their entries into our lines', () => {
  const mapped = invertAccountMap(accountMap())._unsafeUnwrap()

  it('carries the audit pair and the direction', () => {
    const [entry] = groupProviderLedgerEntries(
      balancedEntryLines({ txnType: 'Check', txnId: '143', amount: 90000 })
    )
    const lines = resolveProviderSyncLines(entry!, mapped)._unsafeUnwrap()

    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({
      glAccountId: 'gl_mastercard',
      direction: 'debit',
      amount: 90000,
      sourceType: 'provider_ledger',
      sourceId: '143',
    })
    expect(lines[1]).toMatchObject({ glAccountId: 'gl_checking', direction: 'credit' })
  })

  it('🛑 refuses an unmapped provider account, NAMING it', () => {
    const [entry] = groupProviderLedgerEntries([
      line({
        txnType: 'Check',
        txnId: '143',
        providerAccountId: '777',
        providerAccountName: 'Depreciation Expense',
        debitMinor: 5000,
      }),
      line({ txnType: 'Check', txnId: '143', providerAccountId: '35', creditMinor: 5000 }),
    ])
    const refused = resolveProviderSyncLines(entry!, mapped)

    expect(refused.isErr()).toBe(true)
    const message = refused._unsafeUnwrapErr().message
    expect(message).toContain("'777'")
    expect(message).toContain('Depreciation Expense')
    // Never a guess and never a fallback account.
    expect(message).toContain('never guesses an account')
  })

  it('names EVERY unmapped account at once, not the first', () => {
    const [entry] = groupProviderLedgerEntries([
      line({
        txnType: 'Check',
        txnId: '9',
        providerAccountId: '777',
        providerAccountName: 'Depreciation',
        debitMinor: 5000,
      }),
      line({
        txnType: 'Check',
        txnId: '9',
        providerAccountId: '888',
        providerAccountName: 'Accum. Depreciation',
        creditMinor: 5000,
      }),
    ])
    const message = resolveProviderSyncLines(entry!, mapped)._unsafeUnwrapErr().message
    expect(message).toContain('777')
    expect(message).toContain('888')
  })

  it('drops a zero LEG rather than refusing the transaction over it', () => {
    const [entry] = groupProviderLedgerEntries([
      line({ txnType: 'Check', txnId: '10', providerAccountId: '41', debitMinor: 5000 }),
      line({ txnType: 'Check', txnId: '10', providerAccountId: '35', creditMinor: 5000 }),
      // No money, and on an account nothing is mapped to. Neither fact matters.
      line({ txnType: 'Check', txnId: '10', providerAccountId: '777' }),
    ])
    const lines = resolveProviderSyncLines(entry!, mapped)._unsafeUnwrap()
    expect(lines).toHaveLength(2)
  })

  it('refuses a row populating BOTH money columns - the report cannot render one', () => {
    const [entry] = groupProviderLedgerEntries([
      line({
        txnType: 'Check',
        txnId: '11',
        providerAccountId: '41',
        debitMinor: 100,
        creditMinor: 100,
      }),
    ])
    const refused = resolveProviderSyncLines(entry!, mapped)
    expect(refused.isErr()).toBe(true)
    expect(refused._unsafeUnwrapErr().message).toContain('both money columns')
  })
})

describe('an empty chunk', () => {
  it('is a valid plan, not an error', () => {
    const plan = planProviderSync({
      ledger: ledger([], { hasData: false }),
      ourProviderEntryIds: new Set(),
      ourEntries: [],
      accountMap: accountMap(),
    })
    expect(plan._unsafeUnwrap()).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
      theirs: [],
      ours: [],
      unbalanced: [],
    })
  })
})
