// apps/web/src/app/(protected)/app/parts/import/page.tsx

import { redirect } from 'next/navigation'

/**
 * Parts import entry point.
 * Redirects to the upload step for a new import.
 */
export default function PartsImportPage() {
  redirect('/app/parts/import/new?step=upload')
}
