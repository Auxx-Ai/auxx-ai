// apps/web/src/components/accounting/ui/journal/entries-list.tsx

'use client'

import type { JournalEntryLine, PostingSummary } from '@auxx/lib/postings/client'
import { Badge } from '@auxx/ui/components/badge'
import { TREE_SECONDARY_NOTRUNCATE, TreeRow } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { cn } from '@auxx/ui/lib/utils'
import { FileText } from 'lucide-react'
import { formatMinor } from '~/components/accounting/ui/ledger/format'
import { api } from '~/trpc/react'

interface EntriesListProps {
  /**
   * The month to list. Omitted when no period resolves at all - an org whose
   * cutoff is still ahead of the wall clock has no closable month, and the
   * drafts a bookkeeper has raised still have to be reachable.
   */
  periodKey?: string
  currencyCode: string
  /** Row click on a posted/reversed entry - opens `PostingDrawer` via `?posting=`. */
  onSelectPosting: (id: string) => void
  /** Row click on a draft - opens the JE drawer via `?je=<id>`. */
  onSelectJournalEntry: (id: string) => void
}

/** One row's `journal_entry_status`/`GlPosting.status` collapsed to a common vocabulary. */
type EntryStatus = 'posted' | 'reversed' | 'pending' | 'failed' | 'draft'

interface EntryRow {
  key: string
  kind: 'posting' | 'draft'
  id: string
  /** Sorted on this, newest first - `postedAt` for a posting, `createdAt` for a draft. */
  sortKey: string
  title: string
  docNumber: string | null
  amountMinor: number
  status: EntryStatus
}

/** The exact dot classes `ledger-toolbar.tsx`'s `STATE_DOT` uses, per ui-plan.md §2.1. */
const STATUS_DOT: Record<EntryStatus, string> = {
  posted: 'bg-green-500',
  reversed: 'bg-primary-400',
  pending: 'bg-amber-500',
  failed: 'bg-destructive',
  draft: 'bg-amber-500',
}

const STATUS_LABEL: Record<EntryStatus, string> = {
  posted: 'Posted',
  reversed: 'Reversed',
  pending: 'In flight',
  failed: 'Failed',
  draft: 'Draft',
}

/**
 * The period's OTHER entries - everything the inline month-end entry does not
 * already show. Two sources, merged into one list (ui-plan.md §2.1):
 *
 * - `ledger.listPostings` - every posting this month except `month_end_inventory`
 *   (already excluded server-side), posted or reversed.
 * - `ledger.journalEntry.list` with `status: 'draft'` - entries a bookkeeper has
 *   started but not posted. `GlPosting` has no draft status (traps §8), so this
 *   is the only door to them.
 *
 * 🛑 The draft read is filtered to `kind: 'manual'`. An `opening_balance`
 * draft belongs to the setup wizard and the opening-balances settings page, and
 * a `recurring_template` is a template - neither can be posted from this row,
 * and rendering them here offered a Post the server then refused.
 *
 * ⚠️ With no `periodKey` BOTH reads widen to the whole ledger rather than being
 * skipped. An org whose accounting is finalized with a cutoff in the future
 * resolves no month at all, and this section is the only door to a manual
 * entry, so listing nothing there hid every posting on exactly the screen
 * somebody opens to find one.
 */
export function EntriesList({
  periodKey,
  currencyCode,
  onSelectPosting,
  onSelectJournalEntry,
}: EntriesListProps) {
  const postingsQuery = api.ledger.listPostings.useQuery(periodKey ? { periodKey } : {})
  const draftsQuery = api.ledger.journalEntry.list.useQuery({
    ...(periodKey ? { periodKey } : {}),
    kind: 'manual',
    status: 'draft',
  })

  // A DISABLED query sits at `isPending` forever, so the postings half only
  // counts toward the skeleton when it was actually asked for.
  const loading = (!!periodKey && postingsQuery.isPending) || draftsQuery.isPending

  const rows: EntryRow[] = [
    ...(postingsQuery.data ?? []).map(postingToRow),
    ...(draftsQuery.data ?? []).map(draftToRow),
  ].sort((a, b) => b.sortKey.localeCompare(a.sortKey))

  if (!loading && rows.length === 0) {
    return (
      <p className='py-1 text-sm text-muted-foreground'>
        {periodKey ? 'No other entries this month.' : 'No journal entries yet.'}
      </p>
    )
  }

  return (
    <TreeRowList
      items={rows}
      loading={loading}
      skeletonCount={2}
      getKey={(row) => row.key}
      renderRow={(row) => (
        <TreeRow
          className={TREE_SECONDARY_NOTRUNCATE}
          icon={<FileText className='size-4' />}
          title={<span className='truncate text-sm'>{row.title}</span>}
          secondary={
            <span className='flex items-center gap-1.5'>
              {row.docNumber && (
                <Badge variant='outline' size='xs' className='font-mono'>
                  {row.docNumber}
                </Badge>
              )}
              <span className='font-mono text-xs tabular-nums'>
                {formatMinor(row.amountMinor, currencyCode)}
              </span>
              <span className='flex items-center gap-1 text-xs text-muted-foreground'>
                <span className={cn('size-1.5 rounded-full', STATUS_DOT[row.status])} aria-hidden />
                {STATUS_LABEL[row.status]}
              </span>
            </span>
          }
          onToggleOpen={() =>
            row.kind === 'posting' ? onSelectPosting(row.id) : onSelectJournalEntry(row.id)
          }
        />
      )}
    />
  )
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
  }
}

/** The draft's own total - the sum of its debit legs (an unbalanced draft has none yet). */
function sumDebits(lines: JournalEntryLine[]): number {
  return lines
    .filter((line) => line.direction === 'debit')
    .reduce((sum, line) => sum + line.amountMinor, 0)
}
