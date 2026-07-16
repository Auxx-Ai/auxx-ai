// apps/web/src/app/(protected)/app/tickets/dashboard/page.tsx

import { EntityDashboardPage } from '~/components/dashboard/ui/entity-dashboard-page'

/**
 * Dashboard page — the ticket entity dashboard (plan 02). The tickets layout
 * owns `MainPage`/the RadioTab header; `EntityDashboardPage` renders
 * `MainPageContent` itself, per the layout's docking contract.
 */
export default function TicketDashboardPage() {
  return <EntityDashboardPage slug='tickets' />
}
