// apps/web/src/app/(protected)/app/purchase-orders/page.tsx

'use client'

import { RecordsView } from '~/components/records'

/**
 * Purchase orders page — renders the shared RecordsView for the
 * `purchase-orders` resource (plans/purchasing/01-build-plan.md §4.4).
 */
export default function PurchaseOrdersPage() {
  return <RecordsView slug='purchase-orders' basePath='/app/purchase-orders' />
}
