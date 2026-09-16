// packages/lib/src/postings/export-gate/types.ts
//
// The vocabulary of the pre-export reconciliation gate
// (plans/accounting/tasks/53-two-modes-one-ledger.md D12, §2.1, §8 risk 1).
//
// PURE. Types and unions only - no database, no logger, no clock - so the queue
// panel can import them through `postings/client` without dragging the reads in.

import type { CloseBlockerItemKey } from '../close-blockers'
import type { PostingType } from '../types'

/**
 * Which of the gate's three questions a finding came from.
 *
 * They are kept apart rather than collapsed into one score because they fail
 * for unrelated reasons and are fixed in three different places: a bad entry is
 * fixed with a reversing journal, an incomplete month by posting the rest of it,
 * and an unreconciled bank by clearing the review queue.
 */
export const EXPORT_GATE_CHECKS = [
  'entry_balance',
  'source_completeness',
  'bank_reconciliation',
] as const
export type ExportGateCheck = (typeof EXPORT_GATE_CHECKS)[number]

/**
 * What one finding is about.
 *
 * 🔑 The three completeness keys are `CloseBlockerItemKey` values REUSED
 * verbatim, not a parallel set. The close console already routes those keys to a
 * remedy button, and the labels behind them come out of the same
 * `describeIncompleteRevenue` the close refusal uses - so a month that blocks a
 * close and a month that blocks a send say the identical sentence. Inventing a
 * second spelling of "14 shipments are not posted" is exactly the defect
 * `close-blockers.ts`'s own header was written to prevent.
 */
export type ExportGateFindingKey =
  | CloseBlockerItemKey
  | 'entry_unbalanced'
  | 'bank_unreviewed'
  | 'bank_coverage_gap'

/**
 * Whether a finding stops the send or merely rides along with it.
 *
 * 🛑 `block` is reserved for the cases where sending is definitely wrong and the
 * damage is hard to undo - D11 re-delivers by DELETING the provider's copy, and
 * §7.4.1 consequence (4) is that a period the provider has since closed cannot
 * be re-delivered at all. Everything else is `warn`: an operator may perfectly
 * legitimately send a month's revenue before the bank has cleared it, and a gate
 * that refused would be teaching people to ignore it.
 */
export type ExportGateSeverity = 'block' | 'warn'

/**
 * One reason a posting is not ready, in words an operator can act on.
 *
 * Deliberately the same two-part shape as `CloseBlockerItem`: `label` is what is
 * wrong and `remedy` is what to do, kept apart so a row can render the label and
 * put the remedy on a button, and joined back into one sentence by
 * {@link ExportGateVerdict.message} for the places that only have room for prose.
 */
export interface ExportGateFinding {
  key: ExportGateFindingKey
  check: ExportGateCheck
  severity: ExportGateSeverity
  /** What is outstanding. One clause, capitalised, with NO trailing period. */
  label: string
  /** What to do about it. A full sentence ending in a period. */
  remedy: string
  /** How many rows are behind it. Absent when the finding is a single thing. */
  count?: number
  /** What the remedy has to target: a month key, a bank account id. */
  ref?: string
}

/** `clear` has no findings at all; `warn` has only warnings; `block` refuses. */
export type ExportGateStatus = 'clear' | 'warn' | 'block'

/** The gate's answer for ONE posting. */
export interface ExportGateVerdict {
  glPostingId: string
  docNumber: string
  postingType: PostingType
  periodKey: string
  status: ExportGateStatus
  findings: ExportGateFinding[]
  /**
   * The findings projected into one sentence, or `null` when there are none.
   *
   * 🛑 A PROJECTION of `findings`, never written independently - the same rule
   * `close-blockers.ts` states for the close refusal. This is the string that
   * lands on `SyncReleaseOutcome.message` and renders as the amber line on the
   * sync queue row, so it has to stay identical to the rows beside it rather
   * than merely similar.
   */
  message: string | null
}

/**
 * The gate's answer for a set of postings, plus what it could not answer.
 *
 * ⚠️ `unavailable` is the honest half and the reason this is a report rather
 * than a boolean. A check that could not run produces NO findings, so its
 * postings read as `clear` - which is indistinguishable from "checked and fine"
 * unless the report says which questions were never asked. Same rule
 * `countIncompleteRevenue` follows with `null` instead of `0`, and for the same
 * reason: silence must not be reported as an all-clear.
 */
export interface ExportGateReport {
  /** ISO 8601. The gate is evaluated at the moment of asking and stored nowhere. */
  checkedAt: string
  postingsChecked: number
  /** How many verdicts came back `block`. */
  blocked: number
  /** How many came back `warn`. */
  warned: number
  verdicts: ExportGateVerdict[]
  /**
   * The checks that did not run, so a caller knows the gate is partial.
   *
   * A check lands here when its read failed, or when the organization has
   * nothing for it to look at - an org with no bank feed has an unanswered bank
   * question, not a reconciled one.
   */
  unavailable: ExportGateCheck[]
}
