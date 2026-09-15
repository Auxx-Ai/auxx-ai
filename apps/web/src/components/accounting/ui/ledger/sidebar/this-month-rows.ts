// apps/web/src/components/accounting/ui/ledger/sidebar/this-month-rows.ts

import { POSTING_POLICIES, type PostingPolicy, type PostingType } from '@auxx/lib/postings/client'
import { formatNextFire, nextFire } from './next-fire'

/** The shape `ledger.monthActivity` answers with, as this module reads it. */
export interface MonthActivityInput {
  byType: Array<{ postingType: PostingType; count: number; lastTxnDate: string }>
  unpostedShipments: number | null
  unpostedCreditMemos: number | null
}

export interface ThisMonthRow {
  type: PostingType
  label: string
  /** `'12 entries, last Sep 13'`, or `'No entries yet'`. */
  entries: string
  /** `'today 04:30 UTC'` for a `schedule` trigger, once the browser clock is known. */
  next: string | null
  /** `'2 shipments waiting for the dialog'`, or `null` when nothing is. */
  waiting: string | null
}

/**
 * One row per posting type that has something to say about this month, in
 * policy declaration order (plans/accounting/tasks/28-how-your-books-post.md
 * §6). PURE: the component is a thin render of what this returns.
 *
 * A row appears for a type that posted in the month, a type with something
 * waiting for its bulk dialog, or an enabled `schedule` type - the sweep that
 * will post next is a fact about the month even before it has. Everything is
 * read off the declared policy (§2): the label, the trigger, and the cron the
 * "next" clause is computed from.
 *
 * ⚠️ A type declared `enabled: false` still gets a row when it POSTED. What
 * landed in the books is a fact regardless of what the policy says should
 * have; hiding it would make the row disagree with the Entries list beneath.
 * (`provider_sync` is the live case: declared off, written by the Sync button.)
 *
 * `now` is `null` before the browser clock is read (the first render, which is
 * also the server's), and the "next" clause is simply absent then. A clock
 * read during render would print one time on the server and another in the
 * browser and hydrate with a mismatch.
 */
export function thisMonthRows(activity: MonthActivityInput, now: Date | null): ThisMonthRow[] {
  const byType = new Map(activity.byType.map((row) => [row.postingType, row]))

  const rows: ThisMonthRow[] = []
  for (const policy of POSTING_POLICIES) {
    const posted = byType.get(policy.type)
    const waiting = waitingSentence(policy.type, activity)
    const scheduled = policy.enabled && policy.trigger.kind === 'schedule'
    if (!posted && !waiting && !scheduled) continue

    rows.push({
      type: policy.type,
      label: policy.label,
      entries: posted
        ? `${posted.count} ${posted.count === 1 ? 'entry' : 'entries'}, last ${formatDateKey(posted.lastTxnDate)}`
        : 'No entries yet',
      next: now ? nextSentence(policy, now) : null,
      waiting,
    })
  }
  return rows
}

/**
 * What the month still owes a type's bulk dialog. Only `fulfillment` and
 * `credit_memo` have one, and both counts are the balance sweep's own reads.
 * A `null` count (the read failed) says nothing rather than "0".
 */
function waitingSentence(type: PostingType, activity: MonthActivityInput): string | null {
  switch (type) {
    case 'fulfillment': {
      const count = activity.unpostedShipments
      if (!count) return null
      return `${count} ${count === 1 ? 'shipment' : 'shipments'} waiting for the dialog`
    }
    case 'credit_memo': {
      const count = activity.unpostedCreditMemos
      if (!count) return null
      return `${count} issued, waiting for the dialog`
    }
    default:
      return null
  }
}

function nextSentence(policy: PostingPolicy, now: Date): string | null {
  if (policy.trigger.kind !== 'schedule') return null
  const next = nextFire(policy.trigger.cron, now)
  return next ? formatNextFire(next, now) : null
}

const DATE_KEY = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
})

/**
 * `'2026-09-13'` as `'Sep 13'`.
 *
 * A txn date is a `YYYY-MM-DD` KEY, not an instant, so it is formatted as the
 * calendar day it names. Parsing it with `new Date()` and formatting in the
 * book zone would print Sep 12 for every viewer west of Greenwich.
 */
export function formatDateKey(dateKey: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateKey)
  if (!match) return dateKey
  return DATE_KEY.format(
    new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  )
}
