// apps/web/src/app/(protected)/app/returns/import/page.tsx

import { redirect } from 'next/navigation'

/**
 * Returns import entry point.
 * Redirects to the upload step for a new import.
 */
export default function ReturnsImportPage() {
  redirect('/app/returns/import/new?step=upload')
}
