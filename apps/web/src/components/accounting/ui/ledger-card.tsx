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

import type { ExportBatchState } from '@auxx/lib/accounting/export/client'
import type {
  PostingDetail,
  PostingLinkRole,
  PostingStatus,
  PostingType,
} from '@auxx/lib/accounting/ledger/client'
import { Badge, type Variant } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@auxx/ui/components/dialog'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { TREE_SECONDARY_NOTRUNCATE, TreeRow } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { BookOpenCheck, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { EmptyRow } from '~/components/drawers/cards/related-record-row'
import { DrawerCardActions } from '~/components/drawers/drawer-card-actions'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import { useSettings } from '~/hooks/use-settings'
import { api } from '~/trpc/react'
import { RecordChipLink } from './banking/payouts/record-chip-link'
import { EntryJournal, journalLinesFromDetail } from './ledger/entry-journal'
import { EMPTY_CELL, formatAccountingDate, formatMinor, humanizePostingType } from './ledger/format'
import { ExportBatchStateBadge } from './ledger/outbox/export-batch-badge'

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

// `recordId` and `record` are optional here, unlike on a drawer tab: the payout
// evidence drawer mounts this card on a record it reached through a
// `MoneyTransfer`, so it has the instance id and no `RecordId`.
export interface LedgerCardProps extends Partial<DrawerTabProps> {
  entityInstanceId: string
  /**
   * The `sourceKind` this record's postings are linked under on
   * `GlPostingSource` (`'order'`, `'invoice'`, `'money_transaction'`,
   * `'bank_deposit'`...). Fixed by the wrapper a registration pins, per
   * `ledgerBlock()`'s pattern for related-record cards, never inferred from
   * the record itself.
   */
  sourceKind: string
  /** Overrides `Nothing posted yet` when this record's empty state means more. */
  emptyLabel?: string
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
  pending: 'Drafted',
}

/**
 * `LedgerCard`: a record sidebar card listing every posting linked to this
 * record on `GlPostingSource`. Row click opens a `Dialog` with the posting's
 * lines (`EntryJournal`, the same journal table `posting-drawer.tsx`
 * renders), since these entries are not on the ledger page's own `?posting=`
 * deep link from here.
 */
export function LedgerCard({ entityInstanceId, sourceKind, emptyLabel }: LedgerCardProps) {
  const { getSetting } = useSettings({})
  const currencyCode = (getSetting('organization.currency') as string | null) ?? 'USD'
  const bookTimeZone = (getSetting('accounting.bookTimeZone') as string | null) ?? 'UTC'

  const [openPostingId, setOpenPostingId] = useState<string | null>(null)

  const _utils = api.useUtils()
  const postingsQuery = api.ledger.listPostingsForSource.useQuery(
    { sourceKind, sourceId: entityInstanceId },
    { enabled: !!entityInstanceId }
  )
  const allPostings = (postingsQuery.data ?? []) as SourcePosting[]
  const loading = postingsQuery.isPending
  // A `pending` row is a draft waiting in the outbox for this record: it holds no
  // claim and no document number yet, so it gets its own row above the list.
  const pendingDrafts = allPostings.filter((posting) => posting.linkRole === 'pending')
  const postings = allPostings.filter((posting) => posting.linkRole !== 'pending')

  // The backward read of `plans/accounting/payout-links.md` §10.3: which payout
  // posting swept the receipts this document was paid by. Only orders and
  // invoices have one - `sweepingPostings` takes no other document.
  const sweepKind = sourceKind === 'order' || sourceKind === 'invoice' ? sourceKind : null
  const sweepsQuery = api.payoutEvidence.sweepingPostings.useQuery(
    sweepKind === 'invoice'
      ? { invoiceInstanceId: entityInstanceId }
      : { orderInstanceId: entityInstanceId },
    { enabled: !!sweepKind && !!entityInstanceId }
  )
  const sweeps = sweepsQuery.data ?? []

  // The batch state badge (step 3 part C, TARGET §4 gate 2): the batches these
  // postings are live members of. No per-posting Retry or Un-sync here, same
  // rule the drawer keeps.
  const glPostingIds = useMemo(() => postings.map((posting) => posting.id), [postings])
  const exportBatchesQuery = api.ledger.exportBatches.list.useQuery(
    { glPostingIds },
    { enabled: glPostingIds.length > 0 }
  )
  const batchStateByPostingId = useMemo(() => {
    const map = new Map<string, ExportBatchState>()
    for (const batch of exportBatchesQuery.data?.items ?? []) {
      for (const member of batch.members) map.set(member.glPostingId, batch.state)
    }
    return map
  }, [exportBatchesQuery.data])

  // The report's `?source=` filter, over the range these postings span, so the
  // page opens on exactly the rows this card lists.
  const ledgerHref = useMemo(() => {
    if (postings.length === 0) return null
    const dates = postings.map((posting) => posting.txnDate).sort()
    const params = new URLSearchParams({
      source: `${sourceKind}:${entityInstanceId}`,
      from: dates[0]!,
      to: dates[dates.length - 1]!,
    })
    return `/app/accounting/reports/general-ledger?${params.toString()}`
  }, [postings, sourceKind, entityInstanceId])

  if (!loading && allPostings.length === 0 && sweeps.length === 0) {
    return <EmptyRow label={emptyLabel ?? 'Nothing posted yet'} />
  }

  return (
    <>
      {ledgerHref && (
        <DrawerCardActions>
          <Button asChild variant='ghost' size='xs'>
            <Link href={ledgerHref}>
              <ExternalLink />
              Open in ledger
            </Link>
          </Button>
        </DrawerCardActions>
      )}
      {pendingDrafts.map((draft) => (
        <TreeRow
          key={draft.id}
          className={TREE_SECONDARY_NOTRUNCATE}
          icon={<BookOpenCheck className='size-4' />}
          title={
            <span className='truncate text-sm'>Drafted — awaiting approval in the outbox</span>
          }
          description={formatAccountingDate(draft.txnDate, bookTimeZone)}
          secondary={
            <span className='flex items-center gap-1.5'>
              <Badge variant='outline' size='xs'>
                {humanizePostingType(draft.postingType)}
              </Badge>
              <Badge variant={STATUS_VARIANT.draft} size='xs'>
                {STATUS_LABEL.draft}
              </Badge>
            </span>
          }
          onToggleOpen={() => setOpenPostingId(draft.id)}
          actions={
            <Button asChild variant='ghost' size='xs'>
              <Link href={`/app/accounting/outbox?tab=drafts&posting=${draft.id}`}>
                <ExternalLink />
                Open outbox
              </Link>
            </Button>
          }
        />
      ))}

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
                {batchStateByPostingId.get(posting.id) && (
                  <ExportBatchStateBadge
                    state={batchStateByPostingId.get(posting.id) as ExportBatchState}
                  />
                )}
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

      {/* A second list, not extra rows in the first: a sweep row has no total of
          its own (the payout's entry is about the whole payout, not this
          document), so it cannot fill the amount column the rows above end on. */}
      {sweeps.length > 0 && (
        <TreeRowList
          items={sweeps}
          getKey={(sweep) => `${sweep.glPostingId}:${sweep.entryId}`}
          renderRow={(sweep) => (
            <TreeRow
              className={TREE_SECONDARY_NOTRUNCATE}
              icon={<BookOpenCheck className='size-4' />}
              title={
                <span className='truncate text-sm'>
                  Swept by payout <span className='font-mono'>{sweep.docNumber ?? EMPTY_CELL}</span>
                </span>
              }
              description={formatAccountingDate(sweep.txnDate, bookTimeZone)}
              secondary={
                <span className='flex items-center gap-1.5'>
                  <Badge
                    variant={STATUS_VARIANT[sweep.status as PostingStatus] ?? 'outline'}
                    size='xs'>
                    {STATUS_LABEL[sweep.status as PostingStatus] ?? sweep.status}
                  </Badge>
                  <Badge variant='outline' size='xs'>
                    Swept
                  </Badge>
                  {sweep.payoutSourceId && (
                    <RecordChipLink
                      document={{
                        kind: 'payout',
                        instanceId: sweep.payoutSourceId,
                        displayName: 'Open payout',
                      }}
                    />
                  )}
                </span>
              }
              onToggleOpen={() => setOpenPostingId(sweep.glPostingId)}
            />
          )}
        />
      )}

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
