// apps/web/src/app/(protected)/app/credit-memos/import/page.tsx

import { redirect } from 'next/navigation'

/**
 * Credit Memos import entry point.
 * Redirects to the upload step for a new import.
 */
export default function CreditMemosImportPage() {
  redirect('/app/credit-memos/import/new?step=upload')
}
