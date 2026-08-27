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
// 🛑 The received figures are only ever as good as the receipts behind them, and
// nothing writes a receipt yet — plans/purchasing/02-handoff.md §4.1's
// `ReceiveStockPopover` is unbuilt. Until it lands every line here reads 0 received.
// That is honest (nothing HAS been received through the app) rather than broken.

import { extractRelationshipRecordIds } from '@auxx/lib/field-values/client'
import type { RecordId } from '@auxx/types/resource'
import { Badge, type Variant } from '@auxx/ui/components/badge'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { Package } from 'lucide-react'
import {
  EmptyRow,
  RowSkeleton,
  TREE_SECONDARY_NOTRUNCATE,
} from '~/components/drawers/cards/related-record-row'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import { useOpenRecord } from '~/components/records/record-drill-panels'
import { useRecord } from '~/components/resources'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { useSystemValuesForRecords } from '~/components/resources/hooks/use-system-values-for-records'
import {
  formatQuantity,
  numberValue,
  PurchasingSummaryStrip,
  unwrapValue,
} from '../purchasing-summary-strip'

const PO_ATTRS = ['purchase_order_lines'] as const

const LINE_ATTRS = [
  'purchase_order_line_part',
  'purchase_order_line_description',
  'purchase_order_line_quantity_ordered',
  'purchase_order_line_quantity_received',
] as const

/** How many lines render before the inline "Show more" row collapses the rest. */
const LINE_PREVIEW_LIMIT = 6

interface ReceivingLine {
  lineRecordId: RecordId
  partRecordId: RecordId | undefined
  description: string | null
  ordered: number
  received: number
}

export function PurchaseOrderReceivingCard({ recordId }: DrawerTabProps) {
  const { values, isLoading: linesLoading } = useSystemValues(recordId, [...PO_ATTRS], {
    autoFetch: true,
  })
  const lineRecordIds = extractRelationshipRecordIds(values.purchase_order_lines)

  const { valuesById, isLoading: valuesLoading } = useSystemValuesForRecords(
    lineRecordIds,
    LINE_ATTRS,
    { autoFetch: true, enabled: lineRecordIds.length > 0 }
  )

  const lines: ReceivingLine[] = lineRecordIds.map((lineRecordId) => {
    const lineValues = valuesById[lineRecordId] ?? ({} as Record<string, unknown>)
    const description = unwrapValue(lineValues.purchase_order_line_description)
    return {
      lineRecordId,
      partRecordId: extractRelationshipRecordIds(lineValues.purchase_order_line_part)[0],
      description: typeof description === 'string' && description ? description : null,
      ordered: numberValue(lineValues.purchase_order_line_quantity_ordered),
      received: numberValue(lineValues.purchase_order_line_quantity_received),
    }
  })

  const ordered = lines.reduce((sum, line) => sum + line.ordered, 0)
  const received = lines.reduce((sum, line) => sum + line.received, 0)
  // Per line rather than on the totals: an over-receipt on one line must not
  // cancel an under-receipt on another and report the order complete.
  const outstanding = lines.reduce(
    (sum, line) => sum + Math.max(0, line.ordered - line.received),
    0
  )

  const loading = linesLoading || (lineRecordIds.length > 0 && valuesLoading)
  if (loading) return <RowSkeleton />
  if (lineRecordIds.length === 0) return <EmptyRow label='No lines yet' />

  return (
    <div className={`space-y-0.5 ${TREE_SECONDARY_NOTRUNCATE}`}>
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

function ReceivingLineRow({ line }: { line: ReceivingLine }) {
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
function receivingProgress(line: ReceivingLine): { label: string; variant: Variant } {
  const qty = `${formatQuantity(line.received)} / ${formatQuantity(line.ordered)}`
  if (line.received > line.ordered) return { label: `${qty} over`, variant: 'amber' }
  if (line.ordered > 0 && line.received >= line.ordered) return { label: qty, variant: 'green' }
  if (line.received > 0) return { label: qty, variant: 'amber' }
  return { label: qty, variant: 'secondary' }
}
