// apps/web/src/app/(protected)/app/shipments/import/page.tsx

import { redirect } from 'next/navigation'

/**
 * Shipments import entry point.
 * Redirects to the upload step for a new import.
 */
export default function ShipmentsImportPage() {
  redirect('/app/shipments/import/new?step=upload')
}
