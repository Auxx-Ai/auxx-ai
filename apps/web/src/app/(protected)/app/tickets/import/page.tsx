// apps/web/src/app/(protected)/app/tickets/import/page.tsx

import { redirect } from 'next/navigation'

/**
 * Ticket import entry point.
 * Redirects to the upload step for a new import.
 */
export default function TicketsImportPage() {
  redirect('/app/tickets/import/new?step=upload')
}
