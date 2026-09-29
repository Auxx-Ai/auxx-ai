// apps/web/src/app/(protected)/app/parcels/import/page.tsx

import { redirect } from 'next/navigation'

/**
 * Parcels import entry point.
 * Redirects to the upload step for a new import.
 */
export default function ParcelsImportPage() {
  redirect('/app/parcels/import/new?step=upload')
}
