// apps/web/src/app/(protected)/app/orders/import/page.tsx

import { redirect } from 'next/navigation'

/**
 * Orders import entry point.
 * Redirects to the upload step for a new import.
 */
export default function OrdersImportPage() {
  redirect('/app/orders/import/new?step=upload')
}
