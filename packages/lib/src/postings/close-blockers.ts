// packages/lib/src/postings/close-blockers.ts
//
// One refusal, broken into the pieces of work it is actually made of.
//
// ── Why this file exists ────────────────────────────────────────────────────
//
// `revenue_incomplete` is not one problem. It is up to three independent ones -
// a shipment that left with no posting behind it, a channel credit memo nobody
// has issued or voided, and an issued memo whose entry has never been run - and
// each is fixed somewhere different. `classifyIncompleteRevenue` computed all
// three counts separately and then string-joined them into a single sentence,
// which left the close console with one paragraph and one button for three
// remedies. The button pointed at the orders list, which is the right
// destination for exactly one of the three.
//
// 🛑 The SENTENCE IS A PROJECTION OF THE ITEMS, never a parallel implementation.
// `closeBlockerMessage` is the only place the prose is assembled, and it is
// assembled out of the same `CloseBlockerItem`s the console renders as rows. The
// moment a screen hand-writes its own version of one of these labels, the
// refusal an operator reads and the refusal the books recorded can disagree -
// which is how `books-health.tsx` ended up telling the same three counts in a
// second, differently-worded voice further down the same page.
//
// PURE. No database, no logger, no clock. It is on the client surface because
// the console renders it, and a count-to-sentence function that ran only on the
// server would have to be duplicated in the browser to render a badge.

/** Which piece of work an item is, so a screen picks the remedy without parsing prose. */
export type CloseBlockerItemKey =
  | 'unposted_shipments'
  | 'draft_channel_memos'
  | 'unposted_credit_memos'
  | 'unmapped_role'

/**
 * One outstanding piece of work behind a refusal.
 *
 * `label` and `remedy` are two halves of one sentence and are kept apart on
 * purpose: a tree row shows the label and puts the remedy on a button, while
 * {@link closeBlockerMessage} joins them back into the prose that is stored on
 * the posting and read in the logs.
 */
export interface CloseBlockerItem {
  key: CloseBlockerItemKey
  /** What is outstanding. One clause, capitalised, with NO trailing period. */
  label: string
  /** What to do about it. A full sentence ending in a period. */
  remedy: string
  /** How many rows are behind it. Absent when the item is a single thing. */
  count?: number
  /** What the remedy has to target: a role name, a month key. */
  ref?: string
}

/** The counts the completeness gate reads, in the order it reads them. */
export interface IncompleteRevenueCounts {
  /** The MONTH key being closed, `'2026-01'`. Carried onto every item's `ref`. */
  periodKey: string
  /** Shipped fulfillments with no live posting. */
  shipments: number
  /** `channel` credit memos still sitting as a draft. */
  draftChannelMemos: number
  /** Issued credit memos whose entry has never been run (25 §9.1). */
  unpostedCreditMemos: number
}

/**
 * What a month still owes the ledger, as items rather than a paragraph.
 *
 * A zero count produces NO item. An operator with one problem should see one
 * row, not three rows two of which say "nothing to do here" - a satisfied row
 * is noise on a card whose whole job is to list work.
 *
 * @param counts The month and its three outstanding counts.
 * @returns One item per non-zero count, in remedy order. Empty when the month is
 * complete, which is the caller's signal not to refuse at all.
 */
export function describeIncompleteRevenue(counts: IncompleteRevenueCounts): CloseBlockerItem[] {
  const { periodKey, shipments, draftChannelMemos, unpostedCreditMemos } = counts
  const month = monthLabel(periodKey)
  const items: CloseBlockerItem[] = []

  if (shipments > 0) {
    items.push({
      key: 'unposted_shipments',
      label: `${shipments} ${shipments === 1 ? 'shipment is' : 'shipments are'} not posted`,
      remedy: `Post the fulfillments for ${month} with the posting dialog.`,
      count: shipments,
      ref: periodKey,
    })
  }

  if (draftChannelMemos > 0) {
    items.push({
      key: 'draft_channel_memos',
      label:
        `${draftChannelMemos} channel credit ${draftChannelMemos === 1 ? 'memo is' : 'memos are'} ` +
        'still a draft',
      remedy: `Issue or void the channel credit memos dated in ${month}.`,
      count: draftChannelMemos,
      ref: periodKey,
    })
  }

  if (unpostedCreditMemos > 0) {
    items.push({
      key: 'unposted_credit_memos',
      label:
        `${unpostedCreditMemos} issued credit ` +
        `${unpostedCreditMemos === 1 ? 'memo is' : 'memos are'} not posted`,
      remedy: `Post the credit memos for ${month} with the posting dialog.`,
      count: unpostedCreditMemos,
      ref: periodKey,
    })
  }

  return items
}

/**
 * The lead sentence `revenue_incomplete` opens with, before its items.
 *
 * Separate from {@link closeBlockerMessage} so the console can render the lead
 * as a row title and the items as its children without re-splitting a string.
 */
export function incompleteRevenueLead(periodKey: string): string {
  return `${monthLabel(periodKey)} still holds revenue that is not in the books.`
}

/**
 * The items, joined back into the prose a refusal is stored and logged as.
 *
 * 🛑 The ONE place this prose is assembled. `PostResult.error` crosses into the
 * job log, the posting row and every non-console caller, so it has to stay a
 * complete sentence; this function is what keeps it identical to the rows the
 * console renders instead of merely similar to them.
 *
 * @param lead The opening sentence, ending in a period.
 * @param items The outstanding work. An empty array returns the lead alone.
 */
export function closeBlockerMessage(lead: string, items: readonly CloseBlockerItem[]): string {
  if (items.length === 0) return lead
  return `${lead} ${items.map((item) => `${item.label}. ${item.remedy}`).join(' ')}`
}

/**
 * The roles an `account_unmapped` refusal named, as items.
 *
 * `resolveRoles` refuses with one sentence per offending role and attaches the
 * role names and their reasons as two parallel arrays on the error's `details` -
 * parallel because `AuxxErrorDetails` values may only be `string | string[]`.
 * This is the only reader of that pairing, and it fails CLOSED: details that are
 * missing, the wrong shape, or of unequal length produce no items at all, and
 * the console falls back to rendering the verbatim message it always rendered.
 * A card that invented a role name would send somebody to remap an account that
 * was never the problem.
 *
 * @param details The refusing error's `details`.
 * @returns One item per role, or an empty array when the pairing is unusable.
 */
export function describeUnmappedRoles(details: unknown): CloseBlockerItem[] {
  if (!details || typeof details !== 'object') return []
  const roles = (details as Record<string, unknown>).unresolvedRoles
  const reasons = (details as Record<string, unknown>).unresolvedReasons
  if (!Array.isArray(roles) || !Array.isArray(reasons)) return []
  if (roles.length === 0 || roles.length !== reasons.length) return []

  const items: CloseBlockerItem[] = []
  for (const [index, role] of roles.entries()) {
    const reason = reasons[index]
    if (typeof role !== 'string' || typeof reason !== 'string') return []
    items.push({ key: 'unmapped_role', label: role, remedy: reason, ref: role })
  }
  return items
}

/**
 * `'2026-07'` becomes `'July 2026'`, for a refusal sentence.
 *
 * The year is carried deliberately: a close console can be looking at any month
 * of any year, and "Post the fulfillments for July" is ambiguous the moment an
 * organization is more than a year old. A key that is not a month is returned
 * unchanged rather than mangled - `GlPosting` documents keys that are not dates
 * at all.
 */
export function monthLabel(periodKey: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(periodKey)
  if (!match) return periodKey
  const year = Number(match[1])
  const month = Number(match[2])
  if (!Number.isFinite(year) || month < 1 || month > 12) return periodKey
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, 1)))
}
