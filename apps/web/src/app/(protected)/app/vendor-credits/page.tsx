// apps/web/src/app/(protected)/app/vendor-credits/page.tsx
'use client'

import { RecordsView } from '~/components/records'

/**
 * Vendor credits page, the shared RecordsView for the `vendor-credits` resource
 * (plans/accounting/tasks/done/71-one-cash-endpoint.md §5 U7). Drawer-only, like
 * the credit memo it mirrors on the buy side: there is no `[vendorCreditId]/`
 * detail route, so opening a row opens the drawer.
 */
export default function VendorCreditsPage() {
  return <RecordsView slug='vendor-credits' basePath='/app/vendor-credits' />
}
