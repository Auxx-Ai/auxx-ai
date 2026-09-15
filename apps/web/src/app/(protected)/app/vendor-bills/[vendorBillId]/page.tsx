// apps/web/src/app/(protected)/app/vendor-bills/[vendorBillId]/page.tsx

import { DetailView } from '~/components/detail-view'

interface PageProps {
  params: Promise<{ vendorBillId: string }>
}

/** Vendor bill document review using the shared full-screen record view. */
export default async function VendorBillDetailPage({ params }: PageProps) {
  const { vendorBillId } = await params
  return <DetailView apiSlug='vendor_bill' instanceId={vendorBillId} backUrl='/app/vendor-bills' />
}
