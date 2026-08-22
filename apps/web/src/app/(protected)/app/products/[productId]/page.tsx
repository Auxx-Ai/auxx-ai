// apps/web/src/app/(protected)/app/products/[productId]/page.tsx

import { DetailView } from '~/components/detail-view'

type Props = { params: Promise<{ productId: string }> }

/**
 * Product detail page using the universal DetailView component
 * (plans/products/01-product-family.md phase 3, the quotes/[quoteId] recipe).
 * `product` has `hasDetailPage: true` — a family is something you open and
 * edit, not a ledger row.
 */
async function ProductDetailPage({ params }: Props) {
  const { productId } = await params
  return <DetailView apiSlug='product' instanceId={productId} backUrl='/app/products' />
}

export default ProductDetailPage
