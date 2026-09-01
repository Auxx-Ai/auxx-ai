// apps/web/src/app/(protected)/app/builds/import/page.tsx

import { redirect } from 'next/navigation'

/**
 * Builds import entry point.
 * Redirects to the upload step for a new import.
 */
export default function BuildsImportPage() {
  redirect('/app/builds/import/new?step=upload')
}
