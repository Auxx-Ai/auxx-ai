// packages/lib/src/postings/export-gate/findings.ts
//
// The gate's prose, and the one table that decides which source stream a
// posting is a claim about.
//
// PURE. No database, no logger, no clock - the same property `close-blockers.ts`
// has and for the same reason: the sync queue renders these findings as rows in
// the browser, and a label that only existed on the server would have to be
// written a second time there.
//
// 🛑 THE SENTENCE IS A PROJECTION OF THE FINDINGS. {@link exportGateMessage} is
// the only place the prose is assembled, out of the same items the queue renders.
// The moment a screen hand-writes its own version of one of these labels, the
// refusal an operator reads and the refusal the gate recorded can disagree.

import { type CloseBlockerItem, type CloseBlockerItemKey, monthLabel } from '../close-blockers'
import type { PostingType } from '../types'
import type {
  ExportGateCheck,
  ExportGateFinding,
  ExportGateSeverity,
  ExportGateStatus,
} from './types'

/**
 * Which source stream each posting type is a CLAIM about.
 *
 * 🔑 This table is the whole reason the gate is usable. An org-wide "the month
 * is incomplete" banner would block every entry dated in that month, including
 * a manual journal that has nothing to do with the missing shipments, and an
 * operator who is blocked on something unrelated learns to route around the
 * gate. A finding only attaches to a posting that actually summarises the stream
 * it is about.
 *
 * ⚠️ Deliberately SHORT, and the omissions are decisions:
 *
 * | omitted | why |
 * | --- | --- |
 * | `month_end_deferral`, `month_end_reversal`, `month_end_inventory` | the close already refuses them on these exact three counts (`close-month.ts` -> `describeIncompleteRevenue`), so a month-end entry cannot exist for an incomplete month. Gating the export too would be a second lock on a door that is already bolted |
 * | `manual_journal`, `opening_balance`, `recurring_journal` | a person wrote them. They assert nothing about how complete the month's revenue is |
 * | `payout`, `payment`, `receipt`, `deposit_application` | 1:1 with one settlement event, not a summary of a period. D20 is the long form of this: recognition and settlement are different events and bucketing one by the other conflates them |
 * | `vendor_bill`, `expense_bill`, `write_off`, `build`, `bank_transaction`, `bank_deposit` | 1:1 with their own source document, and none of the three counts is about them |
 * | `provider_sync` | the accountant authored it in the provider. It is never exported back (`EXPORT_ROUTE_BY_POSTING_TYPE.provider_sync = 'none'`) so it never reaches this gate |
 * | `invoice_issued` | 1:1 with one invoice (53 §5 / handoff §5). Issuance, not a period summary |
 */
export const CLAIMED_SOURCE_STREAMS: Partial<Record<PostingType, readonly CloseBlockerItemKey[]>> =
  {
    fulfillment: ['unposted_shipments'],
    credit_memo: ['draft_channel_memos', 'unposted_credit_memos'],
  }

/**
 * The completeness items this posting type would be blocked by, if any.
 *
 * @param postingType The posting's type.
 * @returns The `CloseBlockerItemKey`s that apply. Empty means the completeness
 * check does not run for this posting at all - which is NOT the same as running
 * and finding nothing, and is why the caller records it as not-applicable rather
 * than as a pass.
 */
export function claimedSourceStreams(postingType: PostingType): readonly CloseBlockerItemKey[] {
  return CLAIMED_SOURCE_STREAMS[postingType] ?? []
}

/**
 * Lift a `CloseBlockerItem` into a gate finding without re-wording it.
 *
 * 🛑 `label` and `remedy` are copied VERBATIM. That is the point: the close
 * console and the sync queue are two screens describing one condition, and the
 * only way they cannot drift is for one of them not to own the words.
 */
export function liftCloseBlockerItem(
  item: CloseBlockerItem,
  check: ExportGateCheck,
  severity: ExportGateSeverity
): ExportGateFinding {
  return {
    key: item.key,
    check,
    severity,
    label: item.label,
    remedy: item.remedy,
    ...(item.count === undefined ? {} : { count: item.count }),
    ...(item.ref === undefined ? {} : { ref: item.ref }),
  }
}

/**
 * The entry itself does not tie, or has no lines under it.
 *
 * 🛑 The one finding that is unconditionally a `block`. Every other refusal here
 * is about the world around the entry being unfinished; this one says the entry
 * is wrong, and handing a provider a journal whose debits and credits disagree
 * either bounces at their validator or - worse, for a header with no lines -
 * posts a perfectly balanced 0 = 0 that nobody notices.
 *
 * @param input The posting's doc number and whether it has any lines at all.
 */
export function describeUnbalancedEntry(input: {
  docNumber: string
  hasLines: boolean
}): ExportGateFinding {
  return {
    key: 'entry_unbalanced',
    check: 'entry_balance',
    severity: 'block',
    label: input.hasLines
      ? `${input.docNumber} does not tie`
      : `${input.docNumber} is a posted header with no lines`,
    remedy:
      'Run the books balance check on the ledger, then correct it with a reversing entry. ' +
      'An unbalanced entry is never fixed by editing it.',
    ref: input.docNumber,
  }
}

/**
 * Bank activity nobody has reviewed on an account this posting moves.
 *
 * ⚠️ A `warn`, never a `block`, for two reasons that are both about honesty
 * rather than leniency. The count is ALL-TIME - `readQueueStats` takes no date
 * bound - so a line that landed this morning would otherwise refuse an entry
 * from March. And sending a month's revenue before the bank has cleared it is a
 * perfectly ordinary thing to do; a gate that called it an error would be
 * training people to click through gates.
 */
export function describeUnreviewedBankLines(input: {
  bankAccountId: string
  bankAccountName: string
  unreviewedCount: number
  oldestUnreviewedDate: string | null
}): ExportGateFinding {
  const { bankAccountName, unreviewedCount, oldestUnreviewedDate } = input
  const since = oldestUnreviewedDate ? `, the oldest dated ${oldestUnreviewedDate}` : ''
  return {
    key: 'bank_unreviewed',
    check: 'bank_reconciliation',
    severity: 'warn',
    label:
      `${unreviewedCount} ${unreviewedCount === 1 ? 'line is' : 'lines are'} still unreviewed on ` +
      `${bankAccountName}${since}`,
    remedy: `Clear the review queue for ${bankAccountName} so the cash in your books is the cash in the bank.`,
    count: unreviewedCount,
    ref: input.bankAccountId,
  }
}

/**
 * The bank feed has holes over an account this posting moves.
 *
 * ⚠️ Also a `warn`, and this one has a third reason on top of the two above:
 * derived gaps are a HEURISTIC. Nothing in the transactions distinguishes "we
 * hold no rows for this week" from "nothing happened that week", so a quiet
 * account manufactures gaps. Refusing an export on a guess is not a gate, it is
 * a coin toss.
 */
export function describeBankCoverageGap(input: {
  bankAccountId: string
  bankAccountName: string
  gapCount: number
}): ExportGateFinding {
  const { bankAccountName, gapCount } = input
  return {
    key: 'bank_coverage_gap',
    check: 'bank_reconciliation',
    severity: 'warn',
    label: `${bankAccountName} has ${gapCount} ${gapCount === 1 ? 'gap' : 'gaps'} in its feed`,
    remedy: `Import or re-sync the missing dates on ${bankAccountName} before you rely on its balance.`,
    count: gapCount,
    ref: input.bankAccountId,
  }
}

/**
 * The verdict a set of findings adds up to.
 *
 * The ONE place severity is collapsed into a status, so the release path, the
 * row badge and the tally cannot disagree about what a posting is.
 */
export function exportGateStatus(findings: readonly ExportGateFinding[]): ExportGateStatus {
  if (findings.some((finding) => finding.severity === 'block')) return 'block'
  return findings.length > 0 ? 'warn' : 'clear'
}

/**
 * The findings, projected into the one sentence a refusal is reported as.
 *
 * The lead names the consequence and the items name the work, which is the same
 * split `incompleteRevenueLead` + `closeBlockerMessage` make. It is assembled
 * here rather than by calling `closeBlockerMessage` only because that function
 * is typed to `CloseBlockerItem[]` and this module's findings carry two fields
 * more; widening it is a one-line change in a file this unit does not own.
 *
 * @param input The posting's identity and its findings.
 * @returns One sentence, or `null` when there is nothing to say.
 */
export function exportGateMessage(input: {
  docNumber: string
  periodKey: string
  findings: readonly ExportGateFinding[]
}): string | null {
  const { findings } = input
  if (findings.length === 0) return null

  const detail = findings.map((finding) => `${finding.label}. ${finding.remedy}`).join(' ')
  return `${exportGateLead(input)} ${detail}`
}

/**
 * The opening clause, which says what HAPPENED rather than what is wrong.
 *
 * Separate from the items so the queue can render the lead as a row title and
 * the findings as its children without re-splitting a string - the same reason
 * `incompleteRevenueLead` is separate from `closeBlockerMessage`.
 */
export function exportGateLead(input: {
  docNumber: string
  periodKey: string
  findings: readonly ExportGateFinding[]
}): string {
  const { docNumber, periodKey, findings } = input
  const status = exportGateStatus(findings)

  if (status !== 'block') {
    return `${docNumber} can be sent, but not everything behind it is settled yet.`
  }
  if (findings.some((finding) => finding.check === 'entry_balance')) {
    return `${docNumber} was not sent: the entry itself is wrong.`
  }
  // The month the completeness check actually looked at, which for a day-keyed
  // posting is the month CONTAINING the key rather than the key. Carried on the
  // finding's `ref` so the lead cannot name a different period than the counts.
  const month =
    findings.find((finding) => finding.check === 'source_completeness')?.ref ?? periodKey
  return `${docNumber} was not sent: ${monthLabel(month)} still holds work that would change it.`
}
