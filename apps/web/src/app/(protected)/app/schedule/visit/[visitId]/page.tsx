// apps/web/src/app/(protected)/app/schedule/visit/[visitId]/page.tsx

import { VisitDetailPage } from '~/components/schedule/ui/visit-detail-page'

type Props = { params: Promise<{ visitId: string }> }

/**
 * Worker visit detail page (08-worker-surface.md §3) — a bespoke mobile-first page.
 * `WorkOrderVisit` is a plain table, not an entity, so the `DetailView` registry (used by
 * `work-orders/[workOrderId]`) doesn't apply here.
 */
async function VisitDetailRoute({ params }: Props) {
  const { visitId } = await params
  return <VisitDetailPage visitId={visitId} />
}

export default VisitDetailRoute
