// apps/web/src/components/drawers/cards/order-work-orders-card.tsx
'use client'

// Order drawer overview block for the work orders linked to this order
// (plans/products/08-order-build.md §5.8). The `order.workOrders` /
// `work_order.order` pair is the MANUAL link standing in for D4's deferred
// order → work-order conversion flow, so this block is read-only: there is no
// "create job from order" action to mirror, unlike the request → quote block
// this recipe comes from (`service-request-related-cards.tsx`).
//
// `order_work_orders` is hidden from the Details field panel
// (`showInPanel: false`), so this card is where the relation surfaces.

import { extractRelationshipRecordIds } from '@auxx/lib/field-values/client'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import type { DrawerTabProps } from '../drawer-tab-registry'
import {
  EmptyRow,
  RelatedRecordRow,
  RowSkeleton,
  TREE_SECONDARY_NOTRUNCATE,
} from './related-record-row'

export function OrderWorkOrdersCard({ recordId }: DrawerTabProps) {
  const { values, isLoading } = useSystemValues(recordId, ['order_work_orders'], {
    autoFetch: true,
  })

  const workOrderRecordIds = extractRelationshipRecordIds(values.order_work_orders)

  if (isLoading) return <RowSkeleton />
  if (workOrderRecordIds.length === 0) return <EmptyRow label='No work orders yet' />

  return (
    <div className={`space-y-0.5 ${TREE_SECONDARY_NOTRUNCATE}`}>
      {workOrderRecordIds.map((id) => (
        <RelatedRecordRow key={id} recordId={id} statusAttr='work_order_status' />
      ))}
    </div>
  )
}
