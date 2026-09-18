// apps/web/src/components/accounting/ui/ledger-card.tsx

'use client'

// `<entityType>:ledger` - every posting linked to this record on
// `GlPostingSource` (TARGET §1), per `plans/accounting/ui-plan.md` §2.3 / §4.4.
// The ONE ledger card (accounting migration step 1c) - `order`, `credit_memo`
// and `build` collapsed into this component rather than keeping their own
// composite/bespoke cards; see `ledger-card-registrations.tsx` for the
// `sourceKind` each entity pins.
//
// A `GlPosting` is a Drizzle table with no entity mirror (decision `G6`), so
// this card reads it through a dedicated tRPC procedure rather than the
// generic record list.
//
// Reads `ledger.listPostingsForSource` for every posting linked to this record
// by `sourceKind`/`sourceId`, whatever the link role - `linkRole` is rendered
// as its own badge so a `parent` row (an order listing its fulfillments) reads
// differently from the `subject` row a fulfillment's own card shows.

import type {
  PostingDetail,
  PostingLinkRole,
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
import { formatAccountingDate, formatMinor, humanizePostingType } from './ledger/format'

/** One row of `ledger.listPostingsForSource`'s expected result. */
export interface SourcePosting {
  id: string
  docNumber: string
  postingType: PostingType
  txnDate: string
  totalMinor: number
  status: PostingStatus
  /** How this posting relates to the record - `subject`, `parent`, `counterparty`, `member`. */
  linkRole: PostingLinkRole
}

export interface LedgerCardProps extends DrawerTabProps {
  /**
   * The `sourceKind` this record's postings are linked under on
   * `GlPostingSource` (`'order'`, `'invoice'`, `'money_transaction'`,
   * `'bank_deposit'`...). Fixed by the wrapper a registration pins, per
   * `ledgerBlock()`'s pattern for related-record cards, never inferred from
   * the record itself.
   */
  sourceKind: string
}

const STATUS_VARIANT: Record<PostingStatus, Variant> = {
  draft: 'outline',
  posted: 'green',
  reversed: 'amber',
}

const STATUS_LABEL: Record<PostingStatus, string> = {
  draft: 'Draft',
  posted: 'Posted',
  reversed: 'Reversed',
}

/** How this posting relates to the record - shown as a small badge beside the status. */
const LINK_ROLE_LABEL: Record<PostingLinkRole, string> = {
  subject: 'Subject',
  parent: 'Parent',
  counterparty: 'Counterparty',
  member: 'Member',
}

/**
 * `LedgerCard`: a record sidebar card listing every posting linked to this
 * record on `GlPostingSource`. Row click opens a `Dialog` with the posting's
 * lines (`EntryJournal`, the same journal table `posting-drawer.tsx`
 * renders), since these entries are not on the ledger page's own `?posting=`
 * deep link from here.
 */
export function LedgerCard({ entityInstanceId, sourceKind }: LedgerCardProps) {
  const { getSetting } = useSettings({})
  const currencyCode = (getSetting('organization.currency') as string | null) ?? 'USD'
  const bookTimeZone = (getSetting('accounting.bookTimeZone') as string | null) ?? 'UTC'

  const [openPostingId, setOpenPostingId] = useState<string | null>(null)

  const _utils = api.useUtils()
  const postingsQuery = api.ledger.listPostingsForSource.useQuery(
    { sourceKind, sourceId: entityInstanceId },
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
                <Badge variant='outline' size='xs'>
                  {LINK_ROLE_LABEL[posting.linkRole]}
                </Badge>
              </span>
            }
            onToggleOpen={() => setOpenPostingId(posting.id)}
            actions={
              <span className='flex shrink-0 items-center gap-1 pr-1'>
                <span className='font-mono text-sm tabular-nums'>
                  {formatMinor(posting.totalMinor, currencyCode)}
                </span>
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

/**
 * The posting's lines, opened from a row.
 *
 * Exported because `order-payments-card.tsx` reads a different list (payments
 * and refunds, not fulfillment postings) and would otherwise be a second copy
 * of this dialog: the journal a row opens must not depend on which card the
 * row came from.
 */
export function PostingLinesDialog({
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
