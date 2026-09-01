// apps/web/src/app/(protected)/app/vendor-bills/import/page.tsx

import { redirect } from 'next/navigation'

/**
 * Vendor Bills import entry point.
 * Redirects to the upload step for a new import.
 */
export default function VendorBillsImportPage() {
  redirect('/app/vendor-bills/import/new?step=upload')
}
