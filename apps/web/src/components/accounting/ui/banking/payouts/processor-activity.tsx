// apps/web/src/components/accounting/ui/banking/payouts/processor-activity.tsx

'use client'

import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { TREE_SECONDARY_NOTRUNCATE, TreeRow } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import {
  ArrowDownLeft,
  ArrowUpRight,
  type LucideIcon,
  Percent,
  Receipt,
  Scale,
  Undo2,
} from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { SourceAccountBadge } from '~/components/accounting/ui/source-account-badge'
import { EmptyState } from '~/components/global/empty-state'
import { api } from '~/trpc/react'
import { formatEvidenceAmount, formatEvidenceDate } from './evidence-format'

/**
 * Exact keys only — `processorActivityKindSchema` (evidence-contracts.ts) is the
 * whole vocabulary, and `type` is a plain text column, so an unrecognised value
 * falls back to the neutral receipt rather than borrowing a glyph that would
 * state something about the entry that the evidence does not.
 */
const TYPE_ICONS: Record<string, LucideIcon> = {
  charge: Receipt,
  refund: Undo2,
  fee: Percent,
  adjustment: Scale,
  outgoing_transfer: ArrowUpRight,
  returned_transfer: ArrowDownLeft,
}

/**
 * Let the label cluster (icon + title + secondary + chevron) wrap.
 *
 * 🛑 Load-bearing, not cosmetic. `TREE_SECONDARY_NOTRUNCATE` is what stops the
 * badges from being clipped, and it does that by making the slot `shrink-0` and
 * `overflow-visible` — so in the 380px docked drawer the type, the date and up
 * to three badges do not shrink, they spill out of the row and paint over the
 * net amount. Wrapping drops them to a second line ONLY when they do not fit,
 * which leaves the full-width "Unassigned" tab on one line. `entry-journal.tsx`
 * (`TWO_LINE_ROW`) is the same fix for the same slot, forced to two lines
 * because a journal memo never fits; here it is width-dependent.
 */
const WRAPPING_LABEL = '[&>div:first-child]:flex-wrap'

/** One label/value line in an expanded row — ids stay whole (they get pasted). */
function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className='flex items-baseline justify-between gap-3'>
      <dt className='shrink-0 text-muted-foreground text-xs'>{label}</dt>
      <dd className='min-w-0 break-all text-right text-xs'>{children}</dd>
    </div>
  )
}

/**
 * Inspect processor entries, including unresolved references and the outgoing payout.
 *
 * 🛑 A `TreeRowList`, not a `<table>`. This renders in the 380px payout drawer
 * beside `PayoutSourceHistory` — already a `TreeRowList` — and one click after a
 * `TreeRowList` of payouts, so a six-column grid with wrapped prose in its cells
 * read as a different product in the same panel (`entry-journal.tsx`,
 * `statement-table.tsx` make the same argument). The loading state was already a
 * `TreeRowSkeleton`; only the content disagreed with it.
 *
 * 🛑 Shared: `payouts-page.tsx` renders this for the payouts page's "Unassigned"
 * tab at full width, where the page's other two tabs are `TreeRow` lists too.
 * Anything added here has to read at both widths.
 */
export function ProcessorActivity({
  transferId,
  unassignedOnly,
}: {
  transferId?: string
  unassignedOnly?: boolean
}) {
  const query = api.payoutEvidence.entries.useInfiniteQuery(
    { transferId, unassignedOnly, limit: 50 },
    { getNextPageParam: (page) => page.nextCursor ?? undefined }
  )
  const entries = query.data?.pages.flatMap((page) => page.items) ?? []

  // Each row starts CLOSED and opening one is tracked as the exception — the
  // inverse of `payout-source-history.tsx`, which opens every row because the
  // rejection reason IS the point of that list. Here the row line already
  // carries what the list is scanned for (amount, match state, date); the
  // expansion holds source ids and remediation prose, which is per-row follow-up.
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set())
  const toggleOpen = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })

  return (
    <>
      {query.error && (
        <Alert variant='destructive'>
          <AlertTitle>Could not load processor activity</AlertTitle>
          <AlertDescription>
            {query.error.message} Use Refresh evidence to try again.
          </AlertDescription>
        </Alert>
      )}
      {!query.isPending && !query.error && entries.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title={unassignedOnly ? 'No unassigned activity' : 'No processor activity'}
          description={
            unassignedOnly
              ? 'No unassigned activity has been imported.'
              : 'No processor activity has been imported for this payout. Check evidence completeness before treating it as an empty payout.'
          }
        />
      ) : (
        <TreeRowList
          items={entries}
          loading={query.isPending}
          skeletonCount={3}
          getKey={(entry) => entry.id}
          // Without this the badges in `secondary` clip — the slot is
          // overflow-hidden and truncating, which cuts pill shapes in half.
          className={TREE_SECONDARY_NOTRUNCATE}
          renderRow={(entry) => {
            const Icon = TYPE_ICONS[entry.type] ?? Receipt
            return (
              <TreeRow
                icon={<Icon className='size-4' />}
                title={entry.externalId}
                secondary={
                  <span className='flex items-center gap-1.5'>
                    <span className='text-xs'>
                      {entry.type.replaceAll('_', ' ')} ·{' '}
                      {formatEvidenceDate(entry.transactionDate)}
                    </span>
                    {!entry.payoutExternalId && (
                      <Badge variant='outline' size='sm'>
                        Unassigned
                      </Badge>
                    )}
                    {entry.isOutgoingTransfer && (
                      <Badge variant='outline' size='sm'>
                        Outgoing payout
                      </Badge>
                    )}
                    <Badge
                      variant={entry.matchState === 'matched' ? 'outline' : 'secondary'}
                      size='sm'>
                      {entry.isOutgoingTransfer ? 'Not applicable' : entry.matchState}
                    </Badge>
                  </span>
                }
                actions={
                  <span className='font-mono text-sm tabular-nums'>
                    {formatEvidenceAmount(entry.netMinor, entry.currency, entry.currencyExponent)}
                  </span>
                }
                rowClassName={WRAPPING_LABEL}
                expandable
                isOpen={openIds.has(entry.id)}
                onToggleOpen={() => toggleOpen(entry.id)}>
                <dl className='flex flex-col gap-1.5 pt-1 pb-2 ps-6 pe-2'>
                  <DetailRow label='Gross'>
                    <span className='font-mono tabular-nums'>
                      {formatEvidenceAmount(
                        entry.grossMinor,
                        entry.currency,
                        entry.currencyExponent
                      )}
                    </span>
                  </DetailRow>
                  <DetailRow label='Fee'>
                    <span className='font-mono tabular-nums'>
                      {formatEvidenceAmount(entry.feeMinor, entry.currency, entry.currencyExponent)}
                    </span>
                  </DetailRow>
                  <DetailRow label='Source account'>
                    <SourceAccountBadge
                      providerKey={entry.providerKey}
                      externalAccountId={entry.externalAccountId}
                      environment={entry.environment}
                      size='sm'
                    />
                  </DetailRow>
                  {entry.sourceTransactionId && (
                    <DetailRow label='Transaction'>{entry.sourceTransactionId}</DetailRow>
                  )}
                  {entry.sourceOrderId && (
                    <DetailRow label='Order'>{entry.sourceOrderId}</DetailRow>
                  )}
                  {entry.matchedMoneyTransactionId && (
                    <DetailRow label='Payment'>{entry.matchedMoneyTransactionId}</DetailRow>
                  )}
                  {!entry.isOutgoingTransfer && entry.matchState === 'unmatched' && (
                    <p className='text-muted-foreground text-xs'>
                      Import the related payment evidence, then refresh. An order reference alone
                      does not establish a payment match.
                    </p>
                  )}
                  {!entry.isOutgoingTransfer && entry.matchState === 'unsupported' && (
                    <p className='text-muted-foreground text-xs'>
                      This activity needs a supported accounting classification before posting.
                    </p>
                  )}
                </dl>
              </TreeRow>
            )
          }}
        />
      )}
      {query.hasNextPage && (
        <Button
          variant='outline'
          loading={query.isFetchingNextPage}
          loadingText='Loading...'
          onClick={() => void query.fetchNextPage()}>
          Load more activity
        </Button>
      )}
    </>
  )
}
