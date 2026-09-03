// apps/web/src/app/(protected)/app/vendor-bills/dashboard/page.tsx
'use client'

import { EntityDashboardPage } from '~/components/dashboard/ui/entity-dashboard-page'

/**
 * Vendor bills entity dashboard, reached via the Dashboard tab that
 * `EntityRouteLayout` emits. The vendor-bills `layout.tsx` owns the `MainPage`
 * shell; `EntityDashboardPage` renders its own `MainPageContent` and shows
 * the create-one empty state until a dashboard is linked to the def.
 */
export default function VendorBillsDashboardPage() {
  return <EntityDashboardPage slug='vendor-bills' />
}
