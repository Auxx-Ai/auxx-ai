// apps/web/src/app/(protected)/app/vendor-credits/import/page.tsx

import { redirect } from 'next/navigation'

/**
 * Vendor Credits import entry point.
 * Redirects to the upload step for a new import.
 */
export default function VendorCreditsImportPage() {
  redirect('/app/vendor-credits/import/new?step=upload')
}
