// apps/web/src/app/(protected)/app/purchase-orders/intake/[draftId]/page.tsx

import { IntakeReviewPage } from '~/components/purchasing/intake/ui/intake-review-page'

interface PageProps {
  params: Promise<{ draftId: string }>
}

/**
 * Review one vendor quote that has been read into a proposed purchase order
 * (plans/money/tasks/38 §6.2).
 *
 * A route rather than a dialog for three reasons: the side-by-side layout needs
 * ~76rem and no `DialogSize` token reaches it, the transcription is a worker job
 * whose result outlives the dialog that started it, and the precedent already
 * sits one directory over at `/app/purchase-orders/import/[jobId]`.
 *
 * The layout above treats any path other than the list as owning its own
 * `MainPage`, which `IntakeReviewPage` does.
 */
export default async function PurchaseOrderIntakeReviewPage({ params }: PageProps) {
  const { draftId } = await params

  return <IntakeReviewPage draftId={draftId} />
}
