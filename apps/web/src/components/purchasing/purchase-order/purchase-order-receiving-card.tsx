// apps/web/src/components/purchasing/purchase-order/purchase-order-receiving-card.tsx
'use client'

// `purchase_order:receiving` — how much of this PO has actually arrived
// (plans/purchasing/01-build-plan.md §4.4, listed as wanted-and-unbuilt on
// `purchase_order.sidebarCards`).
//
// The work-order Billing card's shape: a summary strip of figures, then one TreeRow
// per line. It is the only surface anywhere that answers "what is still outstanding
// on this order" — `purchase_order_line_quantity_received` is a post-commit re-SUM
// over `stock_movement` (`purchasing-hooks.ts`), so it is already maintained; nothing
// had ever read it back.
//
// 🛑 The line set comes from `usePurchaseOrderLines`, the shared read the picker
// and the bill-lines action already use. It used to be a second, hand-rolled copy
// of that read off the PO's `purchase_order_lines` inverse — which is the mirror
// lane, and the mirror is never published (see the hook's own note, and B-9/D-11
// in `plans/events/`). A line added from the Lines card in this same drawer
// therefore never appeared here until the page was reloaded.
//
// The card's header action is the **Receive** dialog — the whole order in one pass,
// everything prefilled as if it all arrived. That is deliberately the door here
// rather than the part-first popover: a part-first receipt sets no
// `purchaseOrderLineId`, so it moves quantity on hand without ever moving the
// numbers this card renders.

import { Badge, type Variant } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { Package, PackagePlus } from 'lucide-react'
import { useState } from 'react'
import {
  EmptyRow,
  RowSkeleton,
  TREE_SECONDARY_NOTRUNCATE,
} from '~/components/drawers/cards/related-record-row'
import { DrawerCardActions } from '~/components/drawers/drawer-card-actions'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import { useOpenRecord } from '~/components/records/record-drill-panels'
import { useRecord } from '~/components/resources'
import { formatQuantity, PurchasingSummaryStrip } from '../purchasing-summary-strip'
import { ReceivePurchaseOrderDialog } from './receive-purchase-order-dialog'
import { type PurchaseOrderLineRow, usePurchaseOrderLines } from './use-purchase-order-lines'

/** How many lines render before the inline "Show more" row collapses the rest. */
const LINE_PREVIEW_LIMIT = 6

export function PurchaseOrderReceivingCard({ recordId }: DrawerTabProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const { lines, isLoading: loading } = usePurchaseOrderLines(recordId)

  const ordered = lines.reduce((sum, line) => sum + line.ordered, 0)
  const received = lines.reduce((sum, line) => sum + line.received, 0)
  // Per line rather than on the totals: an over-receipt on one line must not
  // cancel an under-receipt on another and report the order complete.
  const outstanding = lines.reduce(
    (sum, line) => sum + Math.max(0, line.ordered - line.received),
    0
  )

  if (loading) return <RowSkeleton />
  if (lines.length === 0) return <EmptyRow label='No lines yet' />

  return (
    <div className={`space-y-0.5 ${TREE_SECONDARY_NOTRUNCATE}`}>
      {outstanding > 0 && (
        <DrawerCardActions>
          <Button variant='ghost' size='xs' onClick={() => setDialogOpen(true)}>
            <PackagePlus />
            Receive
          </Button>
        </DrawerCardActions>
      )}
      <ReceivePurchaseOrderDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        purchaseOrderRecordId={recordId}
      />
      <PurchasingSummaryStrip
        className='pb-2'
        cells={[
          { label: 'Ordered', value: formatQuantity(ordered) },
          { label: 'Received', value: formatQuantity(received) },
          {
            label: 'Outstanding',
            value: formatQuantity(outstanding),
            tone: outstanding === 0 ? 'muted' : 'default',
          },
        ]}
      />
      <TreeRowList
        items={lines}
        loading={false}
        getKey={(line) => line.lineRecordId}
        visibleLimit={LINE_PREVIEW_LIMIT}
        renderRow={(line) => <ReceivingLineRow line={line} />}
      />
    </div>
  )
}

function ReceivingLineRow({ line }: { line: PurchaseOrderLineRow }) {
  const openRecord = useOpenRecord()
  const { record } = useRecord({ recordId: line.partRecordId!, enabled: !!line.partRecordId })

  // The part IS a buy-side line's identity (03-line-builder-reuse.md), so it leads;
  // `description` is the fallback for a line whose part has not resolved yet.
  const title = record?.displayName ?? line.description ?? 'Untitled line'
  const progress = receivingProgress(line)

  return (
    <TreeRow
      rowClassName='hover:bg-primary-100'
      icon={<Package className='size-4' />}
      title={<span className='truncate text-sm'>{title}</span>}
      secondary={
        <Badge variant={progress.variant} size='xs'>
          {progress.label}
        </Badge>
      }
      onDrill={line.partRecordId ? () => openRecord?.(line.partRecordId!) : undefined}
    />
  )
}

/**
 * The line's receiving state as a badge.
 *
 * Over-receipt gets its own colour rather than being folded into "received": it is
 * a real condition on the floor (a vendor shipped more than was ordered) and the
 * three-way match will raise it, so hiding it here would contradict the match card.
 */
function receivingProgress(line: PurchaseOrderLineRow): { label: string; variant: Variant } {
  const qty = `${formatQuantity(line.received)} / ${formatQuantity(line.ordered)}`
  if (line.received > line.ordered) return { label: `${qty} over`, variant: 'amber' }
  if (line.ordered > 0 && line.received >= line.ordered) return { label: qty, variant: 'green' }
  if (line.received > 0) return { label: qty, variant: 'amber' }
  return { label: qty, variant: 'secondary' }
}
