// apps/web/src/components/money/ui/order/order-fulfillment-ledger-card.tsx
'use client'

// The order drawer's ledger card, read by STAMP rather than by source line
// (§2.5 of plans/money/tasks/49-bulk-fulfillment-posting.md).
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
// The stamp is the coverage record on the order's own end: every shipment in
// `order_fulfillments[]` carries the `glPostingId` and doc number of the entry
// that recognised it. One row per shipment, which is also the grain a person
// asks about ("did the second box get posted?").
//
// ⚠️ A REVERSED stamp is kept and shown, never hidden. Reversing is how a
// fulfillment posting is undone (§2.6), and an order whose entry was reversed is
// unposted, it re-enters the next preview by construction. A card that dropped
// the reversed row would make that look like the entry was never made.

import type { OrderFulfillmentPostingRef } from '@auxx/lib/money/client'
import { Badge } from '@auxx/ui/components/badge'
import { TREE_SECONDARY_NOTRUNCATE, TreeRow } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { BookOpenCheck } from 'lucide-react'
import { useState } from 'react'
import { PostingLinesDialog } from '~/components/accounting/ui/ledger-card'
import { EmptyRow } from '~/components/drawers/cards/related-record-row'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import { formatDayKey } from '~/components/money/ui/fulfillment-posting/fulfillment-plan-table'
import { useSettings } from '~/hooks/use-settings'
import { api } from '~/trpc/react'

export function OrderFulfillmentLedgerCard({ entityInstanceId }: DrawerTabProps) {
  const { getSetting } = useSettings({})
  const currencyCode = (getSetting('organization.currency') as string | null) ?? 'USD'

  const [openPostingId, setOpenPostingId] = useState<string | null>(null)

  const stampsQuery = api.money.orderFulfillmentPostings.useQuery(
    { orderId: entityInstanceId },
    { enabled: !!entityInstanceId }
  )
  const stamps: OrderFulfillmentPostingRef[] = stampsQuery.data ?? []
  const loading = stampsQuery.isPending

  if (!loading && stamps.length === 0) {
    return <EmptyRow label='Nothing posted yet' />
  }

  return (
    <>
      <TreeRowList
        items={stamps}
        loading={loading}
        skeletonCount={2}
        // The stamp is keyed by shipment, and one posting can stamp two
        // shipments of the same order under a week or month grouping.
        getKey={(stamp) => `${stamp.sequence}-${stamp.glPostingId}`}
        renderRow={(stamp) => (
          <TreeRow
            className={TREE_SECONDARY_NOTRUNCATE}
            icon={<BookOpenCheck className='size-4' />}
            title={
              <span className='truncate font-mono text-sm'>
                {stamp.docNumber ?? 'Not numbered'}
              </span>
            }
            description={`Shipment ${stamp.sequence} · ${formatDayKey(stamp.shippedAt)}`}
            secondary={
              stamp.status === 'reversed' ? (
                <Badge variant='amber' size='xs'>
                  Reversed
                </Badge>
              ) : undefined
            }
            onToggleOpen={() => setOpenPostingId(stamp.glPostingId)}
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
