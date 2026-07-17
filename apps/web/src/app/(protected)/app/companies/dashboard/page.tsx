// apps/web/src/app/(protected)/app/companies/dashboard/page.tsx
'use client'

import { EntityDashboardPage } from '~/components/dashboard/ui/entity-dashboard-page'

/**
 * Companies entity dashboard (plan 02) — reached via the Dashboard tab on the
 * companies entity route. The companies `layout.tsx` (EntityRouteLayout) owns
 * the MainPage shell; `EntityDashboardPage` renders its own MainPageContent.
 */
export default function CompaniesDashboardPage() {
  return <EntityDashboardPage slug='companies' />
}
