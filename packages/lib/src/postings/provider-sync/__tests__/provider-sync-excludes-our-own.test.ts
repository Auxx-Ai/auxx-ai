// packages/lib/src/postings/provider-sync/__tests__/provider-sync-excludes-our-own.test.ts
//
// 🛑🛑 **THIS IS THE TEST THAT STANDS BETWEEN A WORKING SYNC AND A DOUBLED
// LEDGER** (brief 20 §5.2, §13).
//
// The general ledger report contains every journal entry auxx has ever pushed.
// A planner that lets one of them through writes it back as a second entry.
// Both copies balance. Every statement still ties. Nothing downstream can
// detect it. It is brief 19 §5.1's failure with the arrows reversed.
//
// So: feed the planner a ledger containing entries this org exported, and
// assert ZERO of them survive into `theirs`.

import { describe, expect, it } from 'vitest'
import { OUR_PROVIDER_TXN_TYPE } from '../client'
import { planProviderSync } from '../plan'
import {
  accountMap,
  balancedEntryLines,
  ledger,
  ourEntry,
  sandboxShapedLedger,
} from './support/fixtures'

describe('the exclusion', () => {
  it('lets zero of our own entries into `theirs`', () => {
    const theirWork = balancedEntryLines({
      txnType: 'Credit Card Expense',
      txnId: '143',
      amount: 90000,
    })
    const ourPushedEntries = [
      ...balancedEntryLines({ txnType: OUR_PROVIDER_TXN_TYPE, txnId: '6', amount: 10000 }),
      ...balancedEntryLines({ txnType: OUR_PROVIDER_TXN_TYPE, txnId: '7', amount: 20000 }),
      ...balancedEntryLines({ txnType: OUR_PROVIDER_TXN_TYPE, txnId: '8', amount: 30000 }),
    ]

    const plan = planProviderSync({
      ledger: ledger([...theirWork, ...ourPushedEntries]),
      ourProviderEntryIds: new Set(['6', '7', '8']),
      ourEntries: [],
      accountMap: accountMap(),
    })

    expect(plan.isOk()).toBe(true)
    const theirs = plan._unsafeUnwrap().theirs
    // The whole assertion, stated two ways on purpose.
    expect(theirs.filter((entry) => ['6', '7', '8'].includes(entry.txnId))).toHaveLength(0)
    expect(theirs.map((entry) => entry.txnId)).toEqual(['143'])
  })

  it('keeps our entries out of `unbalanced` too - they are never write candidates', () => {
    // One of ours, arriving unbalanced (a truncated chunk, or an edit that
    // dropped a leg). It belongs in the CHECK, not in a list of things not to
    // write - we were never going to write it.
    const halfOfOurs = balancedEntryLines({
      txnType: OUR_PROVIDER_TXN_TYPE,
      txnId: '6',
      amount: 10000,
    }).slice(0, 1)

    const plan = planProviderSync({
      ledger: ledger(halfOfOurs),
      ourProviderEntryIds: new Set(['6']),
      ourEntries: [ourEntry({ providerEntryId: '6' })],
      accountMap: accountMap(),
    })

    const value = plan._unsafeUnwrap()
    expect(value.theirs).toHaveLength(0)
    expect(value.unbalanced).toHaveLength(0)
    expect(value.ours.map((check) => check.verdict)).toEqual(['edited'])
  })

  it('🛑 keys on the (type, id) PAIR, so a Purchase sharing an id is still theirs', () => {
    // §4.5: the sandbox shows ids running as one sequence across all 17 types,
    // which is consistent with a single id pool but does not prove one, and
    // Intuit's model is an id per entity type. Keying on the id alone would
    // drop this expense silently.
    const plan = planProviderSync({
      ledger: ledger([
        ...balancedEntryLines({ txnType: OUR_PROVIDER_TXN_TYPE, txnId: '6', amount: 10000 }),
        ...balancedEntryLines({ txnType: 'Credit Card Expense', txnId: '6', amount: 55500 }),
      ]),
      ourProviderEntryIds: new Set(['6']),
      ourEntries: [],
      accountMap: accountMap(),
    })

    const theirs = plan._unsafeUnwrap().theirs
    expect(theirs).toHaveLength(1)
    expect(theirs[0]?.txnType).toBe('Credit Card Expense')
    expect(theirs[0]?.totalDebitMinor).toBe(55500)
  })

  it('excludes every one of ours out of a sandbox-shaped ledger', () => {
    const fixture = sandboxShapedLedger()
    // Claim every `Journal Entry` in the fixture as one auxx pushed - the worst
    // case, and the one an org that has been exporting for a year is in.
    const ourIds = new Set<string>(
      fixture.lines.filter((row) => row.txnType === OUR_PROVIDER_TXN_TYPE).map((row) => row.txnId)
    )
    expect(ourIds.size).toBeGreaterThan(0)

    const plan = planProviderSync({
      ledger: fixture,
      ourProviderEntryIds: ourIds,
      ourEntries: [],
      accountMap: accountMap(),
    })

    const theirs = plan._unsafeUnwrap().theirs
    expect(theirs.filter((entry) => ourIds.has(entry.txnId))).toHaveLength(0)
    expect(theirs.some((entry) => entry.txnType === OUR_PROVIDER_TXN_TYPE)).toBe(false)
  })
})
