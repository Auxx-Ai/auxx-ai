// apps/web/src/app/(protected)/app/vendor-bills/[vendorBillId]/page.tsx

import { VendorBillPage } from '~/components/purchasing/vendor-bill/page/vendor-bill-page'

interface PageProps {
  params: Promise<{ vendorBillId: string }>
}

/**
 * The vendor bill's own page (plans/money/tasks/58 §6.1): document left, cards
 * right. `ModelTypeMeta.vendor_bill.hasDetailPage` is now `true`, so the
 * drawer's expand button, `E`, the row menu's "Open full page" and prev/next
 * all land here — list clicks on `/app/vendor-bills` still open the drawer.
 *
 * The layout above treats any path other than the list/dashboard routes as
 * owning its own `MainPage`, which `VendorBillPage` does.
 */
export default async function VendorBillDetailPage({ params }: PageProps) {
  const { vendorBillId } = await params

  return <VendorBillPage vendorBillId={vendorBillId} />
}
