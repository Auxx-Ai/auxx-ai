// apps/web/src/components/accounting/ui/ledger-card.tsx

'use client'

// `<entityType>:ledger` - the postings whose lines name this record
// (`sourceType`/`sourceId`), per `plans/accounting/ui-plan.md` §2.3 / §4.4.
//
// Copies `manufacturing/builds/build-ledger-card.tsx`'s shape (a `TreeRowList`
// read through a scoped query, click opens the detail), but the source data is
// different: a build's ledger card reads ordinary `stock_movement` records
// through the generic record list, while a `GlPosting` is a Drizzle table with
// no entity mirror (decision `G6`), so this card reads it through a dedicated
// tRPC procedure instead.
//
// Reads `ledger.listPostingsForSource` (slot 1A) for the postings whose lines
// name this record as their source.

import type {
  PostingDetail,
  PostingExportStatus,
  PostingStatus,
  PostingType,
} from '@auxx/lib/postings/client'
import { Badge, type Variant } from '@auxx/ui/components/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@auxx/ui/components/dialog'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { TREE_SECONDARY_NOTRUNCATE, TreeRow } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { BookOpenCheck } from 'lucide-react'
import { useState } from 'react'
import { EmptyRow } from '~/components/drawers/cards/related-record-row'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import { useSettings } from '~/hooks/use-settings'
import { api } from '~/trpc/react'
import { EntryJournal, journalLinesFromDetail } from './ledger/entry-journal'
import { formatAccountingDate, formatMinor } from './ledger/format'

/** One row of `ledger.listPostingsForSource`'s expected result. */
export interface SourcePosting {
  id: string
  docNumber: string
  postingType: PostingType
  txnDate: string
  totalMinor: number
  status: PostingStatus
  exportStatus: PostingExportStatus
  failureReason: string | null
}

export interface LedgerCardProps extends DrawerTabProps {
  /**
   * The `sourceType` this record's postings are filed under (`'order'`,
   * `'invoice'`, `'payment'`, `'bank_deposit'`...). Fixed by the wrapper a
   * future registration pins, per `ledgerBlock()`'s pattern for related-record
   * cards, never inferred from the record itself.
   */
  sourceType: string
}

const STATUS_VARIANT: Record<PostingStatus, Variant> = {
  posted: 'green',
  reversed: 'amber',
}

const STATUS_LABEL: Record<PostingStatus, string> = {
  posted: 'Posted',
  reversed: 'Reversed',
}

/**
 * The EXPORT badge, rendered BESIDE the status and never instead of it.
 *
 * 🛑 Both badges are needed and neither substitutes for the other. Before the
 * export split a refused push flipped `status` to `failed`, so one badge could
 * carry both facts - at the cost of taking the entry out of the books, which is
 * the defect that split them (plans/accounting/export-state-split.md). With
 * `status` now always `Posted` here, a card that showed only `status` would
 * render an entry QuickBooks refused as straightforwardly fine.
 *
 * `exported` and `not_required` deliberately render NOTHING. A badge on the
 * ordinary case is noise, and `not_required` (nothing connected) is a supported
 * configuration under decision P1, not a state to nag about.
 */
const EXPORT_BADGE: Partial<Record<PostingExportStatus, { label: string; variant: Variant }>> = {
  failed: { label: 'Export refused', variant: 'amber' },
  pending: { label: 'Export pending', variant: 'outline' },
}

/** `'manual_journal'` reads `'Manual journal'`. No hardcoded map: the posting-type union grows across waves 1 and 2. */
function humanizePostingType(type: string): string {
  const words = type.split('_')
  return words
    .map((word, index) => (index === 0 ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(' ')
}

/**
 * `LedgerCard`: a record sidebar card listing the postings whose
 * `sourceType`/`sourceId` name this record. Row click opens a `Dialog` with
 * the posting's lines (`EntryJournal`, the same journal table
 * `posting-drawer.tsx` renders), since these entries are not on the ledger
 * page's own `?posting=` deep link from here.
 */
export function LedgerCard({ entityInstanceId, sourceType }: LedgerCardProps) {
  const { getSetting } = useSettings({})
  const currencyCode = (getSetting('organization.currency') as string | null) ?? 'USD'
  const bookTimeZone = (getSetting('accounting.bookTimeZone') as string | null) ?? 'UTC'

  const [openPostingId, setOpenPostingId] = useState<string | null>(null)

  const postingsQuery = api.ledger.listPostingsForSource.useQuery(
    { sourceType, sourceId: entityInstanceId },
    { enabled: !!entityInstanceId }
  )
  const postings = (postingsQuery.data ?? []) as SourcePosting[]
  const loading = postingsQuery.isPending

  if (!loading && postings.length === 0) {
    return <EmptyRow label='Nothing posted yet' />
  }

  return (
    <>
      <TreeRowList
        items={postings}
        loading={loading}
        skeletonCount={2}
        getKey={(posting) => posting.id}
        renderRow={(posting) => (
          <TreeRow
            className={TREE_SECONDARY_NOTRUNCATE}
            icon={<BookOpenCheck className='size-4' />}
            title={<span className='truncate font-mono text-sm'>{posting.docNumber}</span>}
            description={formatAccountingDate(posting.txnDate, bookTimeZone)}
            secondary={
              <span className='flex items-center gap-1.5'>
                <Badge variant='outline' size='xs'>
                  {humanizePostingType(posting.postingType)}
                </Badge>
                <Badge variant={STATUS_VARIANT[posting.status]} size='xs'>
                  {STATUS_LABEL[posting.status]}
                </Badge>
                {EXPORT_BADGE[posting.exportStatus] ? (
                  <Badge
                    variant={EXPORT_BADGE[posting.exportStatus]?.variant}
                    size='xs'
                    title={posting.failureReason ?? undefined}>
                    {EXPORT_BADGE[posting.exportStatus]?.label}
                  </Badge>
                ) : null}
              </span>
            }
            onToggleOpen={() => setOpenPostingId(posting.id)}
            actions={
              <span className='shrink-0 pr-1 font-mono text-sm tabular-nums'>
                {formatMinor(posting.totalMinor, currencyCode)}
              </span>
            }
          />
        )}
      />

      <PostingLinesDialog
        postingId={openPostingId}
        onOpenChange={(open) => !open && setOpenPostingId(null)}
        currencyCode={currencyCode}
      />
    </>
  )
}

function PostingLinesDialog({
  postingId,
  onOpenChange,
  currencyCode,
}: {
  postingId: string | null
  onOpenChange: (open: boolean) => void
  currencyCode: string
}) {
  const query = api.ledger.get.useQuery(
    { id: postingId ?? '' },
    { enabled: !!postingId, staleTime: 30_000 }
  )
  const detail: PostingDetail | undefined = query.data

  return (
    <Dialog open={!!postingId} onOpenChange={onOpenChange}>
      <DialogContent size='xl'>
        <DialogHeader>
          <DialogTitle>{detail ? `Posting ${detail.docNumber}` : 'Posting'}</DialogTitle>
        </DialogHeader>
        {query.isPending && postingId ? (
          <Skeleton className='h-40 w-full' />
        ) : !detail ? (
          <p className='text-muted-foreground text-sm'>No posting matches this link.</p>
        ) : (
          <EntryJournal lines={journalLinesFromDetail(detail.lines)} currencyCode={currencyCode} />
        )}
      </DialogContent>
    </Dialog>
  )
}
