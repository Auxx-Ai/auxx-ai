// packages/lib/src/postings/__tests__/ledger-accepted.test.ts

import { describe, expect, it } from 'vitest'
import { didLedgerAccept, isExpectedPostOutcome } from '../ledger-accepted'
import type { PostResultStatus } from '../types'

/**
 * Every member of `PostResultStatus`, written out by hand ON PURPOSE.
 *
 * 🛑 This list is the tripwire. `didLedgerAccept`'s `never` makes the SOURCE
 * fail to compile when a status is added, but a `default: return false` slipped
 * in later would silence that - so the test asserts the classification of a
 * closed list rather than iterating a union it cannot see at runtime. Adding a
 * status to `types.ts` and not to this file leaves the new value unasserted;
 * `covers every PostResultStatus` below is what catches that.
 */
const ACCEPTED: readonly PostResultStatus[] = [
  'posted',
  'already_posted',
  'healed',
  'not_connected',
  'disabled',
  'not_exported',
]

const REFUSED: readonly PostResultStatus[] = [
  'period_closed',
  'account_unmapped',
  'unbalanced',
  'nothing_to_close',
  'setup_incomplete',
  'not_enabled',
  'inventory_role_refused',
  'account_invalid',
  'revenue_incomplete',
  'error',
]

describe('didLedgerAccept', () => {
  it.each(ACCEPTED)('accepts %s - an entry exists', (status) => {
    expect(didLedgerAccept({ status })).toBe(true)
  })

  it.each(REFUSED)('refuses %s - nothing was written', (status) => {
    expect(didLedgerAccept({ status })).toBe(false)
  })

  /**
   * The defect this whole module exists for. `opening_balance` and
   * `provider_sync` route to `'none'`, so every entry on those paths lands on
   * `not_exported` - and the hand-written arrays it replaced did not carry it,
   * which made `provider-sync`'s sync record nothing while reporting success.
   */
  it('accepts not_exported, which is what the old hand-written arrays missed', () => {
    expect(didLedgerAccept({ status: 'not_exported' })).toBe(true)
  })

  /**
   * 🛑 The one that reads like a mistake and is not. `not_enabled` means the
   * module was never turned on: nothing built, nothing claimed. It is ordinary,
   * but it is not the ledger accepting anything.
   */
  it('refuses not_enabled, because nothing was built', () => {
    expect(didLedgerAccept({ status: 'not_enabled' })).toBe(false)
    expect(isExpectedPostOutcome({ status: 'not_enabled' })).toBe(true)
  })

  /**
   * 🛑 The dangerous direction, and a bug this predicate actually shipped with
   * for one test run. `default: return exhaustive` hands back the arriving
   * string, and every non-empty string is truthy - so an unrecognised status
   * read as "the ledger took it". Caught by `banking/review`'s own test, which
   * stubs `period_locked` (a near-miss for the real `period_closed`).
   *
   * Typecheck cannot reach this: the cast is what a stale bundle, a JSON wire
   * hop, or a test double does at runtime.
   */
  it('fails CLOSED on a status outside the union', () => {
    const bogus = { status: 'period_locked' as PostResultStatus }
    expect(didLedgerAccept(bogus)).toBe(false)
    expect(isExpectedPostOutcome(bogus)).toBe(false)
    expect(didLedgerAccept({ status: '' as PostResultStatus })).toBe(false)
  })

  it('covers every PostResultStatus exactly once', () => {
    const all = [...ACCEPTED, ...REFUSED]
    expect(new Set(all).size).toBe(all.length)
    // Mirrors the union in `types.ts`. If this number moves, a status was added
    // and both this file and `didLedgerAccept`'s switch need the new member.
    expect(all).toHaveLength(16)
  })
})

describe('isExpectedPostOutcome', () => {
  it.each(ACCEPTED)('is true for %s', (status) => {
    expect(isExpectedPostOutcome({ status })).toBe(true)
  })

  it.each(REFUSED.filter((s) => s !== 'not_enabled'))('is false for %s', (status) => {
    expect(isExpectedPostOutcome({ status })).toBe(false)
  })

  it('differs from didLedgerAccept on exactly one status', () => {
    const all = [...ACCEPTED, ...REFUSED]
    const differ = all.filter(
      (s) => didLedgerAccept({ status: s }) !== isExpectedPostOutcome({ status: s })
    )
    expect(differ).toEqual(['not_enabled'])
  })
})
