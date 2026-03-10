// apps/web/src/app/(protected)/app/tickets/page.tsx

'use client'

import { RecordsView } from '~/components/records/records-view'

/**
 * Tickets list page
 * Uses RecordsView in embedded mode (layout provides MainPage wrapper with RadioTab header)
 */
export default function TicketsListPage() {
  return <RecordsView slug='tickets' basePath='/app/tickets' embedded />
}
