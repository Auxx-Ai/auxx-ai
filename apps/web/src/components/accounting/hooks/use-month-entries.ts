// apps/web/src/components/accounting/hooks/use-month-entries.ts

'use client'

import type {
  JournalEntryLine,
  JournalEntryRecord,
  PostingSummary,
} from '@auxx/lib/accounting/journals/client'
import { useMemo } from 'react'
import { api } from '~/trpc/react'

/** A posting's `GlPosting.status`, or `draft` for an unposted journal entry document. */
export type EntryStatus = 'posted' | 'reversed' | 'draft'

export interface EntryRow {
  key: string
  /** What `id` names: a `GlPosting`, or a `journal_entry` record (unposted, or the posting's own entry). */
  kind: 'posting' | 'journal_entry'
  id: string
  /** Sorted on this, newest first - `postedAt` for a posting, `createdAt` for an unposted entry. */
  sortKey: string
  title: string
  docNumber: string | null
  amountMinor: number
  status: EntryStatus
  /** `'JNL-0006'`, or null. Only a journal entry row carries one. */
  number: string | null
}

export interface MonthEntries {
  rows: EntryRow[]
  loading: boolean
  /** How many of `rows` are unposted journal entries. */
  draftCount: number
}

/**
 * The period's entries: this month's postings merged with its manual and
 * recurring journal entries. An unposted entry is its own row; a posted one takes
 * over its posting's row so a click opens the journal drawer (Void, Edit). A
 * `recurring` entry is unposted only when the sweep's post was refused, and
 * stays listed so a person can fix, post or discard it.
 *
 * ⚠️ With no `periodKey` both reads widen to the whole ledger: an org whose cutoff
 * is still ahead resolves no month, and this list is the only door to its entries.
 */
export function useMonthEntries(periodKey?: string): MonthEntries {
  const postingsQuery = api.ledger.listPostings.useQuery(periodKey ? { periodKey } : {})
  const entriesQuery = api.ledger.journalEntry.list.useQuery({
    ...(periodKey ? { periodKey } : {}),
    kinds: ['manual', 'recurring'],
    limit: 200,
  })

  const postings = postingsQuery.data
  const entries = entriesQuery.data

  return useMemo(() => {
    const entryByPosting = new Map<string, JournalEntryRecord>()
    const unposted: JournalEntryRecord[] = []
    for (const entry of entries ?? []) {
      if (entry.status === 'draft') unposted.push(entry)
      else if (entry.glPostingId) entryByPosting.set(entry.glPostingId, entry)
    }

    const rows = [
      ...(postings ?? []).map((posting) => postingToRow(posting, entryByPosting.get(posting.id))),
      ...unposted.map(unpostedToRow),
    ].sort((a, b) => b.sortKey.localeCompare(a.sortKey))

    return {
      rows,
      loading: postingsQuery.isPending || entriesQuery.isPending,
      draftCount: unposted.length,
    }
  }, [postings, entries, postingsQuery.isPending, entriesQuery.isPending])
}

function postingToRow(posting: PostingSummary, entry: JournalEntryRecord | undefined): EntryRow {
  return {
    key: `posting-${posting.id}`,
    kind: entry ? 'journal_entry' : 'posting',
    id: entry?.id ?? posting.id,
    sortKey: posting.postedAt ?? '',
    title: posting.memo || posting.docNumber,
    docNumber: posting.docNumber,
    amountMinor: posting.totalMinor,
    status: posting.status,
    number: entry?.number ?? null,
  }
}

function unpostedToRow(entry: JournalEntryRecord): EntryRow {
  return {
    key: `journal-entry-${entry.id}`,
    kind: 'journal_entry',
    id: entry.id,
    sortKey: entry.createdAt ?? '',
    title: entry.memo || entry.number || 'Untitled journal entry',
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
