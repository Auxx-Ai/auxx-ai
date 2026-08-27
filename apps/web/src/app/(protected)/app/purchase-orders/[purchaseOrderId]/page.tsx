// apps/web/src/app/(protected)/app/purchase-orders/[purchaseOrderId]/page.tsx

import { DetailView } from '~/components/detail-view'

type Props = { params: Promise<{ purchaseOrderId: string }> }

/**
 * Purchase order detail page using the universal DetailView component
 * (plans/purchasing/01-build-plan.md §4.4, the orders/[orderId] recipe).
 * `purchase_order` has `hasDetailPage: true` — a PO is BUILT: drafted, issued and
 * received against, which is page-shaped. The vendor bill, which only records
 * something already settled, is deliberately drawer-only (§5.1) and has no
 * counterpart to this file.
 */
async function PurchaseOrderDetailPage({ params }: Props) {
  const { purchaseOrderId } = await params
  return (
    <DetailView
      apiSlug='purchase_order'
      instanceId={purchaseOrderId}
      backUrl='/app/purchase-orders'
    />
  )
}

export default PurchaseOrderDetailPage
