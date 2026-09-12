// apps/web/src/components/accounting/hooks/use-month-entries.ts

'use client'

import type { JournalEntryLine, PostingSummary } from '@auxx/lib/postings/client'
import { useMemo } from 'react'
import { api } from '~/trpc/react'

/** One row's `journal_entry_status`/`GlPosting.status` collapsed to a common vocabulary. */
export type EntryStatus = 'posted' | 'reversed' | 'pending' | 'failed' | 'draft'

export interface EntryRow {
  key: string
  kind: 'posting' | 'draft'
  id: string
  /** Sorted on this, newest first - `postedAt` for a posting, `createdAt` for a draft. */
  sortKey: string
  title: string
  docNumber: string | null
  amountMinor: number
  status: EntryStatus
  /** `'JNL-0006'`, or null. Only a draft row carries one that Discard can name. */
  number: string | null
}

export interface MonthEntries {
  rows: EntryRow[]
  loading: boolean
  /** How many of `rows` are unposted drafts. */
  draftCount: number
}

/**
 * The period's entries - everything the inline month-end entry does not already
 * show - from two reads merged into one list (ui-plan.md §2.1):
 *
 * - `ledger.listPostings` - every posting this month except `month_end_inventory`
 *   (already excluded server-side), posted or reversed.
 * - `ledger.journalEntry.list` with `status: 'draft'` - entries a bookkeeper has
 *   started but not posted. `GlPosting` has no draft status (traps §8), so this
 *   is the only door to them.
 *
 * 🛑 ONE hook because two callers need the same answer: the list renders these
 * rows and the stats strip counts them. Two hand-written copies of the query
 * inputs share a React Query cache entry only for as long as both copies stay
 * byte-identical - the day one gains a filter the other silently opens a second
 * request and the header disagrees with the list under it.
 *
 * 🛑 The draft read is filtered to the two POSTABLE, hand-reviewed kinds:
 * `manual` and `recurring` (the entries the nightly sweep copied out of a
 * template, task 21 §1). An `opening_balance` draft belongs to the setup wizard
 * and the opening-balances settings page, and a `recurring_template` is the
 * stencil itself - neither can be posted from a row here, and rendering them
 * offered a Post the server then refused by name.
 *
 * ⚠️ `recurring` MUST be here. A generated draft that nobody can see is a
 * scheduler that silently does nothing: the whole point of decision A (draft,
 * not auto-post) is that a bookkeeper looks at the accrual before it lands.
 *
 * ⚠️ With no `periodKey` BOTH reads widen to the whole ledger rather than being
 * skipped. An org whose accounting is finalized with a cutoff in the future
 * resolves no month at all, and the entries list is the only door to a manual
 * entry, so listing nothing there hid every posting on exactly the screen
 * somebody opens to find one.
 */
export function useMonthEntries(periodKey?: string): MonthEntries {
  const postingsQuery = api.ledger.listPostings.useQuery(periodKey ? { periodKey } : {})
  const draftsQuery = api.ledger.journalEntry.list.useQuery({
    ...(periodKey ? { periodKey } : {}),
    kinds: ['manual', 'recurring'],
    status: 'draft',
  })

  const postings = postingsQuery.data
  const drafts = draftsQuery.data

  return useMemo(() => {
    const rows = [...(postings ?? []).map(postingToRow), ...(drafts ?? []).map(draftToRow)].sort(
      (a, b) => b.sortKey.localeCompare(a.sortKey)
    )

    return {
      rows,
      // A DISABLED query sits at `isPending` forever, so the postings half only
      // counts toward the skeleton when it was actually asked for.
      loading: (!!periodKey && postingsQuery.isPending) || draftsQuery.isPending,
      draftCount: rows.filter((row) => row.status === 'draft').length,
    }
  }, [postings, drafts, periodKey, postingsQuery.isPending, draftsQuery.isPending])
}

function postingToRow(posting: PostingSummary): EntryRow {
  return {
    key: `posting-${posting.id}`,
    kind: 'posting',
    id: posting.id,
    sortKey: posting.postedAt ?? '',
    title: posting.memo || posting.docNumber,
    docNumber: posting.docNumber,
    amountMinor: posting.totalMinor,
    status: posting.status === 'reversed' ? 'reversed' : posting.status,
    number: null,
  }
}

function draftToRow(entry: {
  id: string
  number: string | null
  memo: string | null
  lines: JournalEntryLine[]
  createdAt: string | null
}): EntryRow {
  return {
    key: `draft-${entry.id}`,
    kind: 'draft',
    id: entry.id,
    sortKey: entry.createdAt ?? '',
    title: entry.memo || entry.number || 'Untitled draft',
    docNumber: entry.number,
    amountMinor: sumDebits(entry.lines),
    status: 'draft',
    number: entry.number,
  }
}

/** The draft's own total - the sum of its debit legs (an unbalanced draft has none yet). */
function sumDebits(lines: JournalEntryLine[]): number {
  return lines
    .filter((line) => line.direction === 'debit')
    .reduce((sum, line) => sum + line.amountMinor, 0)
}
