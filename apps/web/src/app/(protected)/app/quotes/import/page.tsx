// apps/web/src/app/(protected)/app/quotes/import/page.tsx

import { redirect } from 'next/navigation'

/**
 * Quote import entry point.
 * Redirects to the upload step for a new import.
 */
export default function QuotesImportPage() {
  redirect('/app/quotes/import/new?step=upload')
}
