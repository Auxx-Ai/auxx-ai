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

import type { PostingDetail, PostingType } from '@auxx/lib/postings/client'
import { Badge, type Variant } from '@auxx/ui/components/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@auxx/ui/components/dialog'
import { Section } from '@auxx/ui/components/section'
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
  status: 'pending' | 'posted' | 'failed' | 'reversed'
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

const STATUS_VARIANT: Record<SourcePosting['status'], Variant> = {
  posted: 'green',
  pending: 'outline',
  failed: 'destructive',
  reversed: 'amber',
}

const STATUS_LABEL: Record<SourcePosting['status'], string> = {
  posted: 'Posted',
  pending: 'In flight',
  failed: 'Failed',
  reversed: 'Reversed',
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
          <Section
            title='Journal entry'
            icon={<BookOpenCheck className='size-4' />}
            collapsible={false}>
            <EntryJournal
              lines={journalLinesFromDetail(detail.lines)}
              currencyCode={currencyCode}
            />
          </Section>
        )}
      </DialogContent>
    </Dialog>
  )
}
