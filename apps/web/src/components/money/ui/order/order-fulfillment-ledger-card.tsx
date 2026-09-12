// apps/web/src/components/money/ui/order/order-fulfillment-ledger-card.tsx
'use client'

// The order drawer's ledger card, rebased onto `fulfillment` / `fulfillment_line`
// records (entity migration 153, plans/money/tasks/55-shipment-lines.md §6). One
// row per fulfillment record now, not per JSON log entry.
//
// 🛑 **Why the order cannot use the generic `LedgerCard`.** That card asks
// "which postings have a line naming this record as their source?", which was
// the right question while one order produced one entry. A bulk fulfillment
// summarises a whole day into one entry whose revenue, tax and shipping lines
// carry `sourceType: 'fulfillment_batch'` and the PERIOD KEY as their source, so
// the source lookup finds nothing for the orders inside it. Worse, it does not
// find nothing consistently: the A/R leg stays per order (aging has to name the
// debtor), so a terms order would show a card and a card-paid order in the same
// entry would show none, a difference with no meaning that reads as a bug.
//
// This card reads the ORDER's own fulfillment records (`orderForFulfillment`,
// already used by the fulfill dialog and the line-items tab to prefill
// remaining quantities) rather than the postings-only stamp, because a
// fulfillment now exists - and is worth showing - before it is ever posted, and
// a CANCELLED fulfillment never gets a posting at all. `orderFulfillmentPostings`
// is read alongside it for exactly one thing the record itself cannot say: a
// posting's CURRENT status. `fulfillment_gl_posting` is written once and a
// reversal never clears it (`money/fulfillments/writes.ts`), so "is this
// posting still standing" can only come from the posting itself.
//
// ⚠️ A REVERSED posting is kept and shown, never hidden - reversing is how a
// fulfillment posting is undone, and an order whose entry was reversed is
// unposted, it re-enters the next preview by construction.
//
// 🛑 A CANCELLED fulfillment is a real record, not an absence the connector
// quietly drops (the JSON log's `deriveFulfillments` used to filter these out
// entirely). It renders with its own badge rather than looking like a live
// shipment, and rather than disappearing - `fulfillmentBadge` in the sibling
// `.helpers.ts` file is what decides the priority between cancelled, reversed
// and channel status.

import {
  defaultFulfillmentName,
  type Fulfillment,
  type OrderFulfillmentPostingRef,
} from '@auxx/lib/money/client'
import { Badge } from '@auxx/ui/components/badge'
import { TREE_SECONDARY_NOTRUNCATE, TreeRow } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { BookOpenCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PostingLinesDialog } from '~/components/accounting/ui/ledger-card'
import { EmptyRow } from '~/components/drawers/cards/related-record-row'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import { useSettings } from '~/hooks/use-settings'
import { api } from '~/trpc/react'
import {
  formatShippedAt,
  fulfillmentBadge,
  trackingLabel,
} from './order-fulfillment-ledger-card.helpers'

export function OrderFulfillmentLedgerCard({ entityInstanceId }: DrawerTabProps) {
  const { getSetting } = useSettings({})
  const currencyCode = (getSetting('organization.currency') as string | null) ?? 'USD'

  const [openPostingId, setOpenPostingId] = useState<string | null>(null)

  const orderQuery = api.money.orderForFulfillment.useQuery(
    { orderId: entityInstanceId },
    { enabled: !!entityInstanceId, retry: false }
  )
  // Only for the reversed/posted overlay - see the file header. React Query
  // dedupes this against the same call the fulfill dialog and line-items tab
  // already make for this order, so this is not a second round trip in the
  // common case where the drawer tab and the dialog are both mounted.
  const postingsQuery = api.money.orderFulfillmentPostings.useQuery(
    { orderId: entityInstanceId },
    { enabled: !!entityInstanceId }
  )

  const fulfillments: Fulfillment[] = orderQuery.data?.fulfillments ?? []
  const orderNumber = orderQuery.data?.number ?? null
  const loading = orderQuery.isPending

  const postingStatusByGlPosting = useMemo(() => {
    const map = new Map<string, OrderFulfillmentPostingRef['status']>()
    for (const stamp of postingsQuery.data ?? []) map.set(stamp.glPostingId, stamp.status)
    return map
  }, [postingsQuery.data])

  if (!loading && fulfillments.length === 0) {
    return <EmptyRow label='Nothing shipped yet' />
  }

  return (
    <>
      <TreeRowList
        items={fulfillments}
        loading={loading}
        skeletonCount={2}
        getKey={(fulfillment) => fulfillment.id}
        renderRow={(fulfillment) => {
          const glPostingId = fulfillment.glPosting
          const badge = fulfillmentBadge(
            fulfillment,
            glPostingId ? postingStatusByGlPosting.get(glPostingId) : undefined
          )
          const tracking = trackingLabel(fulfillment)

          return (
            <TreeRow
              className={TREE_SECONDARY_NOTRUNCATE}
              icon={<BookOpenCheck className='size-4' />}
              title={
                glPostingId ? (
                  <span className='truncate font-mono text-sm'>
                    {fulfillment.docNumber ?? 'Not numbered'}
                  </span>
                ) : (
                  <span className='truncate text-muted-foreground text-sm'>
                    {fulfillment.name ?? defaultFulfillmentName(orderNumber, fulfillment.sequence)}
                  </span>
                )
              }
              description={`Shipment ${fulfillment.sequence} · ${formatShippedAt(fulfillment.shippedAt)}`}
              secondary={
                badge ? (
                  <Badge variant={badge.variant} size='xs'>
                    {badge.label}
                  </Badge>
                ) : undefined
              }
              actions={
                tracking ? (
                  fulfillment.trackingUrl ? (
                    <a
                      href={fulfillment.trackingUrl}
                      target='_blank'
                      rel='noreferrer'
                      className='truncate text-primary-400 text-xs hover:underline'>
                      {tracking}
                    </a>
                  ) : (
                    <span className='truncate text-muted-foreground text-xs'>{tracking}</span>
                  )
                ) : undefined
              }
              onToggleOpen={glPostingId ? () => setOpenPostingId(glPostingId) : undefined}
            />
          )
        }}
      />

      <PostingLinesDialog
        postingId={openPostingId}
        onOpenChange={(open) => !open && setOpenPostingId(null)}
        currencyCode={currencyCode}
      />
    </>
  )
}
