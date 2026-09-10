// packages/lib/src/postings/provider-sync/__tests__/provider-sync-detects-an-edit.test.ts
//
// §5.3, verify on read - and §3.4, the hole it closes.
//
// An accountant editing an entry auxx authored is invisible to the write path
// and the read path AT THE SAME TIME: `isOurs` keys on authorship, and an edit
// does not transfer authorship, so the exclusion correctly discards the edited
// entry by the rule as written. Comparing before discarding is the only
// detector that exists.
//
// 🛑 And the comparison REPORTS. There is deliberately no repair anywhere in
// this module - no restating ours from theirs, no re-pushing ours over theirs.
// Both make one entry answer to two authors (§3.1, §11.1, §12.13).

import { describe, expect, it } from 'vitest'
import { OUR_PROVIDER_TXN_TYPE } from '../client'
import { planProviderSync } from '../plan'
import { accountMap, balancedEntryLines, ledger, ourEntry } from './support/fixtures'

/** Our entry `6`, as both sides originally agreed it: Dr Mastercard 900.00 / Cr Checking 900.00. */
function ourSide(over = {}) {
  return ourEntry({ providerEntryId: '6', docNumber: 'AUXX-JNL-JE0006', ...over })
}

function theirSide(amount: number, over: { txnDate?: string } = {}) {
  return balancedEntryLines({
    txnType: OUR_PROVIDER_TXN_TYPE,
    txnId: '6',
    amount,
    txnDate: over.txnDate,
  })
}

describe('an untouched entry', () => {
  it("answers 'matches' with no differences", () => {
    const plan = planProviderSync({
      ledger: ledger(theirSide(90000)),
      ourProviderEntryIds: new Set(['6']),
      ourEntries: [ourSide()],
      accountMap: accountMap(),
    })

    expect(plan._unsafeUnwrap().ours).toEqual([
      {
        glPostingId: 'post_1',
        providerEntryId: '6',
        docNumber: 'AUXX-JNL-JE0006',
        verdict: 'matches',
        differences: [],
      },
    ])
  })
})

describe('an edited entry', () => {
  it("answers 'edited' and names BOTH versions", () => {
    // The accountant opened AUXX-JNL-JE0006 and changed 900.00 to 1,500.00.
    const plan = planProviderSync({
      ledger: ledger(theirSide(150000)),
      ourProviderEntryIds: new Set(['6']),
      ourEntries: [ourSide()],
      accountMap: accountMap(),
    })

    const [check] = plan._unsafeUnwrap().ours
    expect(check?.verdict).toBe('edited')
    const said = check?.differences.join('\n') ?? ''
    // Both versions, by amount, not "these differ".
    expect(said).toContain('$900.00')
    expect(said).toContain('$1,500.00')
    // Named per account as well as in total, so a person knows where to look.
    expect(said).toContain('2100 Mastercard')
    expect(said).toContain('1010 Checking')
  })

  it('reports a changed ACCOUNT, on both sides of the change', () => {
    const plan = planProviderSync({
      ledger: ledger(
        balancedEntryLines({
          txnType: OUR_PROVIDER_TXN_TYPE,
          txnId: '6',
          amount: 90000,
          // They moved the debit off Mastercard and onto Rent.
          debitAccountId: '60',
          creditAccountId: '35',
        })
      ),
      ourProviderEntryIds: new Set(['6']),
      ourEntries: [ourSide()],
      accountMap: accountMap(),
    })

    const [check] = plan._unsafeUnwrap().ours
    expect(check?.verdict).toBe('edited')
    const said = check?.differences.join('\n') ?? ''
    expect(said).toContain('2100 Mastercard')
    expect(said).toContain('Rent')
    expect(said).toContain('not on their copy')
    expect(said).toContain('not on our copy')
  })

  it('reports a re-dated entry, which moves two months at once', () => {
    const plan = planProviderSync({
      ledger: ledger(theirSide(90000, { txnDate: '2026-02-20' })),
      ourProviderEntryIds: new Set(['6']),
      ourEntries: [ourSide({ txnDate: '2026-02-15' })],
      accountMap: accountMap(),
    })

    const [check] = plan._unsafeUnwrap().ours
    expect(check?.verdict).toBe('edited')
    expect(check?.differences.join('\n')).toContain(
      'Date: ours is 2026-02-15, theirs is 2026-02-20'
    )
  })

  it('🛑 reports and does not repair - the entry is not queued to write or re-push', () => {
    const plan = planProviderSync({
      ledger: ledger(theirSide(150000)),
      ourProviderEntryIds: new Set(['6']),
      ourEntries: [ourSide()],
      accountMap: accountMap(),
    })

    const value = plan._unsafeUnwrap()
    expect(value.ours[0]?.verdict).toBe('edited')
    // Nothing anywhere in the plan asks for a write on account of the edit.
    expect(value.theirs).toHaveLength(0)
    expect(value.unbalanced).toHaveLength(0)
  })
})

describe('a deleted entry (§3.5, detected by the other route)', () => {
  it("answers 'missing' when it is dated inside the range that was read", () => {
    const plan = planProviderSync({
      // Their register no longer holds transaction 6 at all.
      ledger: ledger(balancedEntryLines({ txnType: 'Deposit', txnId: '99', amount: 100 })),
      ourProviderEntryIds: new Set(['6']),
      ourEntries: [ourSide({ txnDate: '2026-02-15' })],
      accountMap: accountMap(),
    })

    const [check] = plan._unsafeUnwrap().ours
    expect(check?.verdict).toBe('missing')
    expect(check?.differences.join('\n')).toContain('does not appear')
    expect(check?.differences.join('\n')).toContain('Our books still carry it')
  })

  it('⚠️ says NOTHING about an entry dated outside the range that was read', () => {
    // The comparison is only as good as the range. An entry dated outside the
    // chunk is absent for a benign reason, and reporting it as deleted would
    // declare every entry of ours deleted on the first chunk that did not
    // contain it.
    const plan = planProviderSync({
      ledger: ledger([], { from: '2026-02-01', to: '2026-02-28' }),
      ourProviderEntryIds: new Set(['6']),
      ourEntries: [ourSide({ txnDate: '2026-01-15' })],
      accountMap: accountMap(),
    })

    expect(plan._unsafeUnwrap().ours).toEqual([])
  })

  it('⚠️ tests against the range the provider ECHOED, not the one we asked for', () => {
    // Intuit silently ignores some date parameters, so `ProviderLedger.from`
    // and `.to` are the header's own echo. An entry dated in the requested
    // month but outside the echoed one must not be called missing.
    const plan = planProviderSync({
      ledger: ledger([], { from: '2026-02-10', to: '2026-02-20' }),
      ourProviderEntryIds: new Set(['6']),
      ourEntries: [ourSide({ txnDate: '2026-02-05' })],
      accountMap: accountMap(),
    })

    expect(plan._unsafeUnwrap().ours).toEqual([])
  })

  it('reports on the boundary days of the echoed range', () => {
    for (const txnDate of ['2026-02-01', '2026-02-28']) {
      const plan = planProviderSync({
        ledger: ledger([], { from: '2026-02-01', to: '2026-02-28' }),
        ourProviderEntryIds: new Set(['6']),
        ourEntries: [ourSide({ txnDate })],
        accountMap: accountMap(),
      })
      expect(plan._unsafeUnwrap().ours[0]?.verdict).toBe('missing')
    }
  })
})
