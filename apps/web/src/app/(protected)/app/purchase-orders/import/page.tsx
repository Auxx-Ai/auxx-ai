// apps/web/src/app/(protected)/app/purchase-orders/import/page.tsx

import { redirect } from 'next/navigation'

/**
 * Purchase Orders import entry point.
 * Redirects to the upload step for a new import.
 */
export default function PurchaseOrdersImportPage() {
  redirect('/app/purchase-orders/import/new?step=upload')
}
