// apps/web/src/app/(protected)/app/invoices/import/page.tsx

import { redirect } from 'next/navigation'

/**
 * Invoice import entry point.
 * Redirects to the upload step for a new import.
 */
export default function InvoicesImportPage() {
  redirect('/app/invoices/import/new?step=upload')
}
