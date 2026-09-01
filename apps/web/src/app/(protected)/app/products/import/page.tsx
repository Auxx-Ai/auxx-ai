// apps/web/src/app/(protected)/app/products/import/page.tsx

import { redirect } from 'next/navigation'

/**
 * Products import entry point.
 * Redirects to the upload step for a new import.
 */
export default function ProductsImportPage() {
  redirect('/app/products/import/new?step=upload')
}
