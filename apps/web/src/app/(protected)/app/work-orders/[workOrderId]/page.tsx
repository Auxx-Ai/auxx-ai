// apps/web/src/app/(protected)/app/work-orders/[workOrderId]/page.tsx

import { DetailView } from '~/components/detail-view'

type Props = { params: Promise<{ workOrderId: string }> }

/**
 * Work order (job) detail page using the universal DetailView component
 * (dispatch M2 build spec §F.2) — the `quotes/[quoteId]` recipe. `work_order`
 * flips `hasDetailPage: true`; the job view renders in `layout: 'sections'`
 * mode (`DETAIL_VIEW_CONFIG_REGISTRY.work_order`).
 */
async function WorkOrderDetailPage({ params }: Props) {
  const { workOrderId } = await params
  return <DetailView apiSlug='work_order' instanceId={workOrderId} backUrl='/app/work-orders' />
}

export default WorkOrderDetailPage
