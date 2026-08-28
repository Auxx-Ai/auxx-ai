// apps/web/src/app/(protected)/app/builds/[buildId]/page.tsx

import { DetailView } from '~/components/detail-view'

type Props = { params: Promise<{ buildId: string }> }

/**
 * Build detail page using the universal DetailView component
 * (plans/products/build/01-build-plan.md §3.6, the purchase-orders recipe).
 *
 * `build` is `hasDetailPage: true`: a run is raised, started and completed
 * against, which is page-shaped. Its two sidebar cards — Run and Ledger — are
 * declared in `detail-view-config.ts` and resolved from the shared
 * `DRAWER_TAB_CARD_COMPONENTS` registry, so the page and the drawer offer the
 * same actions rather than the drawer being a read-only half.
 */
async function BuildDetailPage({ params }: Props) {
  const { buildId } = await params
  return <DetailView apiSlug='build' instanceId={buildId} backUrl='/app/builds' />
}

export default BuildDetailPage
