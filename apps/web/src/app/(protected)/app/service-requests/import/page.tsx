// apps/web/src/app/(protected)/app/service-requests/import/page.tsx

import { redirect } from 'next/navigation'

/**
 * Service request import entry point.
 * Redirects to the upload step for a new import.
 */
export default function ServiceRequestsImportPage() {
  redirect('/app/service-requests/import/new?step=upload')
}
