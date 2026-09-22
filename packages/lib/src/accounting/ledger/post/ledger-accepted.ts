// packages/lib/src/accounting/ledger/post/ledger-accepted.ts

import type { PostResultStatus } from '../types'

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
    // An entry exists, balanced and persisted.
    case 'posted':
    // The claim was already held - a converged re-run, a SUCCESS, never a fault.
    case 'already_posted':
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
    case 'nothing_to_recognise':
    case 'error':
    // Not accepted: the module is off, so nothing was built. Callers that treat it
    // as an ordinary skip check the status themselves (task 17 §3).
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
