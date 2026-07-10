// apps/web/src/app/(protected)/app/work-orders/import/page.tsx

import { redirect } from 'next/navigation'

/**
 * Work order import entry point.
 * Redirects to the upload step for a new import.
 */
export default function WorkOrdersImportPage() {
  redirect('/app/work-orders/import/new?step=upload')
}
