// apps/web/src/app/(protected)/app/contacts/import/page.tsx

import { redirect } from 'next/navigation'

/**
 * Contact import entry point.
 * Redirects to the upload step for a new import.
 */
export default function ContactsImportPage() {
  redirect('/app/contacts/import/new?step=upload')
}
