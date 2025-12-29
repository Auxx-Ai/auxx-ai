// apps/web/src/app/(protected)/app/tickets/dashboard/page.tsx

import { MainPageContent } from '@auxx/ui/components/main-page'
import { TicketDashboardContent } from '../_components/ticket-dashboard'

/**
 * Dashboard page - displays ticket analytics and metrics
 */
export default function TicketDashboardPage() {
  return (
    <MainPageContent>
      <TicketDashboardContent />
    </MainPageContent>
  )
}
