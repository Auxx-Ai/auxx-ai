// apps/web/src/app/(protected)/app/companies/import/page.tsx

import { redirect } from 'next/navigation'

/**
 * Company import entry point.
 * Redirects to the upload step for a new import.
 */
export default function CompaniesImportPage() {
  redirect('/app/companies/import/new?step=upload')
}
