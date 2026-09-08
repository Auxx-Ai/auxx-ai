// packages/lib/src/banking/__tests__/removal-gate.test.ts

/**
 * The bank-account removal gate, with **no database**
 * (plans/bank-connection/08-removing-a-bank-account.md §8).
 *
 * 🛑 `resolveRemoval` has exactly ONE term - `hasEverPosted` - and every test
 * here exists to keep it that way. The failure this guards against is somebody
 * "simplifying" the gate to read the transaction rows instead: `undoReview` sets
 * `bank_transaction_gl_posting_id` back to null, so a row-derived predicate
 * flips back to false while the `GlPosting` it reversed and the reversal itself
 * both stay in the books forever. An account that permanently changed the ledger
 * would become hard-deletable again the moment somebody undid the last review.
 *
 * Tested the way `import/reverse.ts`'s `refusalReason` is: pure, exhaustive, and
 * without a single double.
 */

import { describe, expect, it } from 'vitest'
import type { BankAccountRemovalFacts } from '../client'
import { resolveRemoval } from '../writes'

function facts(partial: Partial<BankAccountRemovalFacts> = {}): BankAccountRemovalFacts {
  return {
    hasEverPosted: false,
    transactionCount: 0,
    matchedCount: 0,
    unreviewedCount: 0,
    connectorId: null,
    rules: [],
    ...partial,
  }
}

const THREE_RULES = [
  { id: 'rule_1', name: 'Monthly bank fee' },
  { id: 'rule_2', name: 'Card payments' },
  { id: 'rule_3', name: 'Transfer to savings' },
]

describe('resolveRemoval - hasEverPosted is the only term', () => {
  it('deletes a bare account', () => {
    expect(resolveRemoval(facts()).verb).toBe('delete')
  })

  it('deletes an account with 400 rows, a live connector and three rules', () => {
    const plan = resolveRemoval(
      facts({
        transactionCount: 400,
        matchedCount: 12,
        unreviewedCount: 388,
        connectorId: 'conn_1',
        rules: THREE_RULES,
      })
    )
    expect(plan.verb).toBe('delete')
    // Every one of those is the dialog's business and none of them is the gate's.
    expect(plan.cascade).toEqual({ transactions: 400, matched: 12, releasesAtStripe: true })
    expect(plan.warnings).toEqual(THREE_RULES)
  })

  it('deletes an account whose rows are MATCHED but never coded', () => {
    // ⚠️ A real decision (§5.1): a match is evidence ABOUT an entry, never the
    // entry itself, and blocking on it would let one auto-detected transfer make
    // a wrongly-connected account permanently undeletable.
    const plan = resolveRemoval(facts({ transactionCount: 9, matchedCount: 9 }))
    expect(plan.verb).toBe('delete')
    expect(plan.cascade.matched).toBe(9)
  })

  it('archives once anything has posted, whatever else is true', () => {
    expect(resolveRemoval(facts({ hasEverPosted: true })).verb).toBe('archive')
    expect(
      resolveRemoval(
        facts({
          hasEverPosted: true,
          transactionCount: 0,
          matchedCount: 0,
          unreviewedCount: 0,
          connectorId: null,
          rules: [],
        })
      ).verb
    ).toBe('archive')
    expect(
      resolveRemoval(
        facts({
          hasEverPosted: true,
          transactionCount: 400,
          matchedCount: 12,
          unreviewedCount: 388,
          connectorId: 'conn_1',
          rules: THREE_RULES,
        })
      ).verb
    ).toBe('archive')
  })

  it('names no cascade for an archive, because an archive destroys nothing', () => {
    const plan = resolveRemoval(
      facts({ hasEverPosted: true, transactionCount: 1240, matchedCount: 3 })
    )
    // 🛑 "1,240 transactions will be deleted" in front of somebody about to
    // archive is a lie that reads exactly like the truth on the other branch.
    expect(plan.cascade.transactions).toBe(0)
    expect(plan.cascade.matched).toBe(0)
  })

  it('carries the unreviewed count on BOTH branches - the archive excludes them', () => {
    expect(resolveRemoval(facts({ unreviewedCount: 14 })).unreviewed).toBe(14)
    expect(resolveRemoval(facts({ hasEverPosted: true, unreviewedCount: 14 })).unreviewed).toBe(14)
  })

  it('reports the Stripe release on both branches - archive disconnects first', () => {
    expect(resolveRemoval(facts({ connectorId: 'conn_1' })).cascade.releasesAtStripe).toBe(true)
    expect(
      resolveRemoval(facts({ hasEverPosted: true, connectorId: 'conn_1' })).cascade.releasesAtStripe
    ).toBe(true)
    expect(resolveRemoval(facts()).cascade.releasesAtStripe).toBe(false)
  })

  it('never blocks on a rule - it names it', () => {
    const plan = resolveRemoval(facts({ rules: THREE_RULES }))
    expect(plan.verb).toBe('delete')
    expect(plan.warnings.map((rule) => rule.name)).toEqual([
      'Monthly bank fee',
      'Card payments',
      'Transfer to savings',
    ])
  })
})

describe('resolveRemoval - the flag survives every undo', () => {
  /**
   * 🛑 The test §5.1's whole argument reduces to.
   *
   * `undoReview` on the only coded row, a posting reversal, and `reverseImport`
   * each leave `bank_account_has_posted` TRUE - the write paths are asserted not
   * to touch it in `review/__tests__/writes.test.ts` and
   * `__tests__/reverse-keeps-has-posted.test.ts` - and this is the consequence
   * that matters: the account still archives, and never becomes deletable again.
   */
  const AFTER_EVERY_UNDO = facts({
    hasEverPosted: true,
    // What each undo path leaves behind, and none of it is the gate's business:
    // the line is back in `for_review`, carries no posting id, and nothing on the
    // account looks posted any more.
    transactionCount: 1,
    matchedCount: 0,
    unreviewedCount: 1,
  })

  it('still archives after undoReview returned the only coded row to the queue', () => {
    expect(resolveRemoval(AFTER_EVERY_UNDO).verb).toBe('archive')
  })

  it('still archives after the posting was reversed', () => {
    // A reversal is a SECOND GlPosting at revision N+1; both halves stay in the
    // register. There is more in the books after a reversal, not less.
    expect(resolveRemoval({ ...AFTER_EVERY_UNDO, transactionCount: 1 }).verb).toBe('archive')
  })

  it('still archives after reverseImport removed every row it was allowed to', () => {
    // The import is gone and the account holds nothing at all. It still archives:
    // the entry that was posted from one of those rows is still in the ledger.
    expect(
      resolveRemoval({ ...AFTER_EVERY_UNDO, transactionCount: 0, unreviewedCount: 0 }).verb
    ).toBe('archive')
  })

  it('would WRONGLY delete if the gate were derived from the rows', () => {
    // The counter-example, kept explicit so the reason for the stored field is
    // legible: every row-shaped signal says "nothing here ever posted", and the
    // stored flag is the only thing that disagrees.
    const rowDerived = { ...AFTER_EVERY_UNDO, hasEverPosted: false }
    expect(resolveRemoval(rowDerived).verb).toBe('delete')
    expect(resolveRemoval(AFTER_EVERY_UNDO).verb).toBe('archive')
  })
})
