// apps/web/src/components/accounting/hooks/use-month-entries.ts

'use client'

import type { JournalEntryLine, PostingSummary } from '@auxx/lib/accounting/journals/client'
import { useMemo } from 'react'
import { api } from '~/trpc/react'

/** A posting's `GlPosting.status`, or `draft` for an unposted journal entry document. */
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
  /** How many of `rows` are unposted journal entries. */
  draftCount: number
}

/**
 * The period's entries (ui-plan.md §2.1): this month's postings, except `month_end_inventory`,
 * merged with the manual and recurring journal entries a bookkeeper has not posted yet.
 *
 * One hook because the list renders these rows and the stats strip counts them; two copies
 * of the query inputs drift into two requests and a header that disagrees with the list.
 * `opening_balance` and `recurring_template` entries are excluded: neither posts from a row here.
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
    status: posting.status,
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

/** The entry's own total - the sum of its debit legs. */
function sumDebits(lines: JournalEntryLine[]): number {
  return lines
    .filter((line) => line.direction === 'debit')
    .reduce((sum, line) => sum + line.amountMinor, 0)
}
