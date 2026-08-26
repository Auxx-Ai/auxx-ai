// apps/web/src/app/(protected)/app/orders/[orderId]/page.tsx

import { DetailView } from '~/components/detail-view'

type Props = { params: Promise<{ orderId: string }> }

/**
 * Order detail page using the universal DetailView component
 * (plans/products/08-order-build.md §5.8, the quotes/[quoteId] recipe).
 * `order` has `hasDetailPage: true` (D17) — an order links to work orders and is
 * the revenue-by-product read surface, both page-shaped rather than drawer-shaped.
 */
async function OrderDetailPage({ params }: Props) {
  const { orderId } = await params
  return <DetailView apiSlug='order' instanceId={orderId} backUrl='/app/orders' />
}

export default OrderDetailPage
