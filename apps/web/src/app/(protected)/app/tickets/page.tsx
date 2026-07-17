// apps/web/src/app/(protected)/app/tickets/page.tsx

'use client'

import { RecordsView } from '~/components/records/records-view'

/**
 * Tickets list page — the tickets `layout.tsx` (EntityRouteLayout) owns the
 * MainPage shell; RecordsView renders its own MainPageContent + contributions.
 */
export default function TicketsListPage() {
  return <RecordsView slug='tickets' basePath='/app/tickets' />
}
