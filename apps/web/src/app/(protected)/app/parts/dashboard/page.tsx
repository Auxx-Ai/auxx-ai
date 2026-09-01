// apps/web/src/app/(protected)/app/parts/dashboard/page.tsx
'use client'

import { EntityDashboardPage } from '~/components/dashboard/ui/entity-dashboard-page'

/**
 * Parts entity dashboard (plan 02) — reached via the Dashboard tab that
 * `EntityRouteLayout` emits. The parts `layout.tsx` owns the `MainPage` shell;
 * `EntityDashboardPage` renders its own `MainPageContent` and resolves the def
 * server-side from the slug alone.
 */
export default function PartsDashboardPage() {
  return <EntityDashboardPage slug='parts' />
}
