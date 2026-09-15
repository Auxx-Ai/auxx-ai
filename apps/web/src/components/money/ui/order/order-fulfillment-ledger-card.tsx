// apps/web/src/components/money/ui/order/order-fulfillment-ledger-card.tsx
'use client'

// Fulfillment postings come from accepted effect membership. Pending source work
// remains visible even when its date or other accounting inputs are incomplete.

import {
  defaultFulfillmentName,
  type Fulfillment,
  type OrderFulfillmentPostingRef,
} from '@auxx/lib/money/client'
import { LEDGER_CURRENCY } from '@auxx/lib/postings/client'
import { Badge } from '@auxx/ui/components/badge'
import { TREE_SECONDARY_NOTRUNCATE, TreeRow } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { BookOpenCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PostingLinesDialog } from '~/components/accounting/ui/ledger-card'
import { EmptyRow } from '~/components/drawers/cards/related-record-row'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import { api } from '~/trpc/react'
import {
  formatShippedAt,
  fulfillmentBadge,
  trackingLabel,
} from './order-fulfillment-ledger-card.helpers'

export function OrderFulfillmentLedgerCard({ entityInstanceId }: DrawerTabProps) {
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

  const workQuery = api.money.orderAccountingWork.useQuery(
    { orderId: entityInstanceId },
    { enabled: !!entityInstanceId }
  )
  const pendingWork = (workQuery.data ?? []).filter((work) => work.state !== 'accepted')

  const fulfillments: Fulfillment[] = orderQuery.data?.fulfillments ?? []
  const orderNumber = orderQuery.data?.number ?? null
  const loading = orderQuery.isPending || workQuery.isPending || postingsQuery.isPending

  const postingStatusByGlPosting = useMemo(() => {
    const map = new Map<string, OrderFulfillmentPostingRef['status']>()
    for (const stamp of postingsQuery.data ?? []) map.set(stamp.glPostingId, stamp.status)
    return map
  }, [postingsQuery.data])

  const error = orderQuery.error ?? workQuery.error ?? postingsQuery.error
  if (error) return <EmptyRow label={error.message} />

  if (!loading && fulfillments.length === 0 && pendingWork.length === 0) {
    return <EmptyRow label='Nothing shipped yet' />
  }

  return (
    <>
      {pendingWork.map((work) => (
        <TreeRow
          key={work.id}
          icon={<BookOpenCheck className='size-4' />}
          title={
            work.state === 'no_effect'
              ? 'Shipment needs no accounting entry'
              : work.state === 'canceled'
                ? 'Shipment accounting canceled'
                : work.operation === 'correction'
                  ? 'Accounting correction awaiting review'
                  : 'Shipment awaiting accounting'
          }
          description={
            work.reason ??
            (work.effectiveDate ? `Shipped ${work.effectiveDate}` : 'Shipment date is missing')
          }
          secondary={
            <Badge
              variant={
                work.state === 'no_effect' || work.state === 'canceled' ? 'outline' : 'amber'
              }
              size='xs'>
              {work.state === 'no_effect'
                ? 'Not required'
                : work.state === 'canceled'
                  ? 'Canceled'
                  : work.eligibility === 'excluded'
                    ? 'Excluded'
                    : work.state === 'blocked'
                      ? 'Needs attention'
                      : 'Pending'}
            </Badge>
          }
        />
      ))}
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
        currencyCode={LEDGER_CURRENCY}
      />
    </>
  )
}
