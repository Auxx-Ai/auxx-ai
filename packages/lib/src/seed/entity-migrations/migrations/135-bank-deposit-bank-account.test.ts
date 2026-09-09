// packages/lib/src/seed/entity-migrations/migrations/135-bank-deposit-bank-account.test.ts
//
// The one decision in migration 135 that can be wrong without anything failing:
// which deposit gets linked to which bank account.
//
// A wrong link is silent. The deposit still reads fine, its code is still right,
// its entry is untouched - and the removal gate now protects an account the
// money never went into while leaving the real one deletable. So the rule is a
// pure function and every branch of it is pinned here, the way 118's
// `resolveLabel` is.

import { describe, expect, it } from 'vitest'
import { resolveLinkDecision } from './135-bank-deposit-bank-account'

describe('resolveLinkDecision', () => {
  it('links a code that names exactly one bank account', () => {
    expect(resolveLinkDecision('1000', ['acct_1'])).toBe('link')
  })

  // 🛑 The case that made the backfill partial. Three accounts mapped to `1000`
  // in the first org that had deposits at all, and all four of its deposits
  // carry that code - so "pick the first" would have mislinked every one of them.
  it('refuses to guess when a code names more than one bank account', () => {
    expect(resolveLinkDecision('1000', ['acct_1', 'acct_2'])).toBe('ambiguous')
    expect(resolveLinkDecision('1000', ['acct_1', 'acct_2', 'acct_3'])).toBe('ambiguous')
  })

  it('reports a code no bank account is mapped to', () => {
    expect(resolveLinkDecision('9999', [])).toBe('unmatched')
    expect(resolveLinkDecision('9999', undefined)).toBe('unmatched')
  })

  // Distinct from `unmatched`: there is nothing to resolve, not a failure to
  // resolve it. A deposit with no code was never posted to an account.
  it('skips a deposit carrying no code', () => {
    expect(resolveLinkDecision(null, ['acct_1'])).toBe('skip')
    expect(resolveLinkDecision(undefined, ['acct_1'])).toBe('skip')
    expect(resolveLinkDecision('   ', ['acct_1'])).toBe('skip')
  })

  // The migration trims before it looks the code up; the rule must agree, or a
  // padded code would report `skip` on one side and `unmatched` on the other.
  it('treats a whitespace-only code as absent rather than unmatched', () => {
    expect(resolveLinkDecision('', undefined)).toBe('skip')
  })
})
