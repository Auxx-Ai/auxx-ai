// apps/web/src/app/(protected)/app/purchase-orders/dashboard/page.tsx
'use client'

import { EntityDashboardPage } from '~/components/dashboard/ui/entity-dashboard-page'

/**
 * Purchase orders entity dashboard, reached via the Dashboard tab that
 * `EntityRouteLayout` emits. The purchase-orders `layout.tsx` owns the `MainPage`
 * shell; `EntityDashboardPage` renders its own `MainPageContent` and shows
 * the create-one empty state until a dashboard is linked to the def.
 */
export default function PurchaseOrdersDashboardPage() {
  return <EntityDashboardPage slug='purchase-orders' />
}
