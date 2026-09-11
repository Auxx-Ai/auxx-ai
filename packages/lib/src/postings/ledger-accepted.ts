// packages/lib/src/postings/ledger-accepted.ts

import type { PostResultStatus } from './types'

/**
 * Did the LEDGER take the entry?
 *
 * 🛑 This is the ONE answer to "did the ledger take it?". Before it there were
 * ~12 hand-written arrays of status strings across `money/*`, `banking/*`,
 * `postings/*` and the web hooks, each spelling the set out again. Adding
 * `not_exported` in brief 22 §5 silently broke two of them - `provider-sync`'s
 * `isPosted` (the whole inbound sync would have recorded nothing WHILE
 * REPORTING SUCCESS) and `journal-entries`' `landed` - and **typecheck could
 * not see either**, because both were `status === '…'` inside a boolean. Only
 * the four reachable that day were fixed; this exists so a fifth cannot happen.
 *
 * 🛑 Reads `status`, never `exportStatus`. A caller deciding whether the books
 * hold the entry and reading the export's outcome instead is the exact defect
 * `plans/accounting/export-state-split.md` closed: a provider refusal still
 * leaves a real, balanced, persisted entry in OUR ledger, because the
 * accounting system is an exporter and auxx.ai is the system of record
 * (decision P1).
 *
 * ⚠️ The `switch` is deliberate and the `never` at the bottom is the point. A
 * new `PostResultStatus` fails to compile here until somebody classifies it,
 * which is the protection the old arrays could not give: `new Set<string>([…])`
 * accepts any string, so a missing member was invisible until a screen lied.
 * Do not replace it with a `Set` membership test, however tidy.
 */
export function didLedgerAccept(result: { status: PostResultStatus }): boolean {
  switch (result.status) {
    // An entry exists, balanced and persisted, and these five say so directly.
    case 'posted':
    // The claim was already held - a converged re-run, a SUCCESS, never a fault.
    case 'already_posted':
    case 'healed':
    // No provider, or the provider's switch is off. The entry is built and
    // persisted identically and simply never pushed (decision P1).
    case 'not_connected':
    case 'disabled':
    // The posting TYPE routes to `'none'` whatever the org has connected -
    // `opening_balance` and `provider_sync` today. It pushed nothing BY DESIGN,
    // so an export is not merely absent, it is never coming.
    case 'not_exported':
      return true

    // Every one of these wrote NOTHING. A caller that treats them as accepted
    // records a ledger fact that does not exist.
    case 'period_closed':
    case 'account_unmapped':
    case 'unbalanced':
    case 'nothing_to_close':
    case 'setup_incomplete':
    case 'inventory_role_refused':
    case 'account_invalid':
    case 'revenue_incomplete':
    case 'error':
    // 🛑 NOT accepted, and this is the one that reads like a mistake. The
    // accounting module has never been turned on, so nothing was built, nothing
    // claimed, nothing logged (task 17 §3). It is a first-class SILENT case,
    // but it is not the ledger accepting anything - callers that must not warn
    // about it want {@link isExpectedPostOutcome}, which says so by name.
    case 'not_enabled':
      return false

    // 🛑 FAILS CLOSED, and the `void` is why this is not `return exhaustive`.
    //
    // The assignment to `never` is the COMPILE-time guard and must stay. But
    // returning it hands back whatever string actually arrived, and every
    // non-empty string is truthy - so an unrecognised status would read as "the
    // ledger took it", which is the one direction this predicate may never fail
    // in. A runtime value outside the union is reachable in ways typecheck does
    // not cover: a stale bundle, a status crossing a wire as JSON, a test double
    // returning a near-miss (`period_locked` for `period_closed` - a real one,
    // in `banking/review/__tests__/writes.test.ts`, which is what caught this).
    default: {
      const exhaustive: never = result.status
      void exhaustive
      return false
    }
  }
}

/**
 * Is this a normal outcome that needs no warning?
 *
 * {@link didLedgerAccept}, plus `not_enabled`: an org that never turned the
 * accounting module on is as ordinary as one with no provider connected, and
 * the business action - issuing the invoice, banking the deposit, shipping the
 * order - is real and must not be rolled back or logged as a failure for it
 * (task 17 §3).
 *
 * 🛑 Use this for "should I warn / roll back", and {@link didLedgerAccept} for
 * "does a `GlPosting` row exist". They differ on exactly one status and
 * conflating them is how `not_enabled` ended up inside sets named
 * `ACCEPTED_POST_STATUSES` that were also asked whether the books hold an entry.
 */
export function isExpectedPostOutcome(result: { status: PostResultStatus }): boolean {
  return didLedgerAccept(result) || result.status === 'not_enabled'
}
