// apps/web/src/app/(protected)/app/vendor-bills/page.tsx

'use client'

import { RecordsView } from '~/components/records'

/**
 * Vendor bills page — renders the shared RecordsView for the `vendor-bills`
 * resource (plans/purchasing/01-build-plan.md §5.1).
 *
 * This is the ONLY route the bill gets. `vendor_bill` is `hasDetailPage: false`:
 * a bill records something already settled, so it is opened in the drawer rather
 * than on a page of its own, and the exception queue of §6.3 is a saved list view
 * on this same route filtered to `status = exception` — not a page per bill.
 */
export default function VendorBillsPage() {
  return <RecordsView slug='vendor-bills' basePath='/app/vendor-bills' />
}
