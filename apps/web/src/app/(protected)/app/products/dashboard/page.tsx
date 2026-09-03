// apps/web/src/app/(protected)/app/products/dashboard/page.tsx
'use client'

import { EntityDashboardPage } from '~/components/dashboard/ui/entity-dashboard-page'

/**
 * Products entity dashboard, reached via the Dashboard tab that
 * `EntityRouteLayout` emits. The products `layout.tsx` owns the `MainPage`
 * shell; `EntityDashboardPage` renders its own `MainPageContent` and shows
 * the create-one empty state until a dashboard is linked to the def.
 */
export default function ProductsDashboardPage() {
  return <EntityDashboardPage slug='products' />
}
