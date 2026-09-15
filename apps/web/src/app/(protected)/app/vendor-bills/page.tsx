// apps/web/src/app/(protected)/app/vendor-bills/page.tsx

'use client'

import { AddBillButton } from '~/components/purchasing/vendor-bill/add-bill-button'
import { RecordsView } from '~/components/records'

/**
 * Vendor bills page — renders the shared RecordsView for the `vendor-bills`
 * resource (plans/purchasing/01-build-plan.md §5.1).
 *
 * The bill also has a page at `[vendorBillId]` (plans/money/tasks/58 §6.1), but
 * list clicks here still open the drawer — `RecordsView`'s row click has no
 * `hasDetailPage` branch. The drawer's expand button, `E`, and the row menu's
 * "Open full page" reach the page instead. The exception queue of §6.3 is a
 * saved list view on this same route filtered to `status = exception` — not a
 * bespoke row action.
 */
export default function VendorBillsPage() {
  return (
    <RecordsView slug='vendor-bills' basePath='/app/vendor-bills' pageActions={<AddBillButton />} />
  )
}
