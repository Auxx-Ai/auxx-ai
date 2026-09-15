// apps/web/src/app/(protected)/app/purchase-orders/[purchaseOrderId]/page.tsx

import { DetailView } from '~/components/detail-view'

type Props = { params: Promise<{ purchaseOrderId: string }> }

/**
 * Purchase order detail page using the universal DetailView component.
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
