// apps/web/src/app/(protected)/app/custom/[slug]/dashboard/page.tsx
'use client'

import { useParams } from 'next/navigation'
import { EntityDashboardPage } from '~/components/dashboard/ui/entity-dashboard-page'

/**
 * Generic custom-entity dashboard (plan 02) — one wiring covers every custom
 * entity def, reached via the Dashboard tab on the entity route. The
 * `custom/[slug]/layout.tsx` (EntityRouteLayout) owns the MainPage shell;
 * `EntityDashboardPage` renders its own MainPageContent.
 */
export default function CustomEntityDashboardPage() {
  const params = useParams<{ slug: string }>()
  return <EntityDashboardPage slug={params.slug} />
}
