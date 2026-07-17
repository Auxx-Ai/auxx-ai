// apps/web/src/app/(protected)/app/contacts/dashboard/page.tsx
'use client'

import { EntityDashboardPage } from '~/components/dashboard/ui/entity-dashboard-page'

/**
 * Contacts entity dashboard (plan 02) — reached via the Dashboard tab on the
 * contacts entity route. The contacts `layout.tsx` (EntityRouteLayout) owns
 * the MainPage shell; `EntityDashboardPage` renders its own MainPageContent.
 */
export default function ContactsDashboardPage() {
  return <EntityDashboardPage slug='contacts' />
}
