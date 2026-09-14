// apps/web/src/app/(protected)/app/returns/intake/[draftId]/page.tsx

import { ReturnIntakeReviewPage } from '~/components/returns/intake/ui/return-intake-review-page'

interface PageProps {
  params: Promise<{ draftId: string }>
}

/**
 * Review the return labels a worker photographed at the dock
 * (plans/money/tasks/57 §7.2).
 *
 * A route rather than a dialog for `quote-intake-dialog.tsx`'s reason:
 * `DialogNavPages` caps at `3xl` = 56rem and the review needs the photo beside
 * the fields. It also gives the dock a URL a second person can open.
 *
 * ⚠️ Unlike `/app/purchase-orders/intake/[draftId]`, this page does NOT own a
 * `MainPage`: `app/(protected)/app/returns/layout.tsx` mounts one for every path
 * under `/app/returns` unconditionally, so `ReturnIntakeReviewPage` renders only
 * `MainPageContent` and contributes its header actions through `MainPageAction`.
 */
export default async function ReturnIntakeReviewRoute({ params }: PageProps) {
  const { draftId } = await params

  return <ReturnIntakeReviewPage draftId={draftId} />
}
