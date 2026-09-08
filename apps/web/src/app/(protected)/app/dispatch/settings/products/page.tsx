// apps/web/src/app/(protected)/app/dispatch/settings/products/page.tsx

import { redirect } from 'next/navigation'

/**
 * The sellable catalog consolidated onto `/app/catalog` (Products and
 * Services), which now owns the tax-rates tab this route used to own too. Kept
 * as a redirect rather than deleted: the route was linked from the dispatch
 * getting-started cards and the line-builder's catalog picker for months, so
 * bookmarks and any external links still resolve.
 *
 * The `s` tab param is forwarded, the tab values are unchanged apart from
 * `products` → `items`, so an old `?s=tax-rates` deep link lands on the right
 * tab instead of the default one.
 */
export default async function DispatchProductsSettings({
  searchParams,
}: {
  searchParams: Promise<{ s?: string }>
}) {
  const { s } = await searchParams
  const tab = s === 'products' ? 'items' : s
  redirect(tab ? `/app/catalog?s=${encodeURIComponent(tab)}` : '/app/catalog')
}
