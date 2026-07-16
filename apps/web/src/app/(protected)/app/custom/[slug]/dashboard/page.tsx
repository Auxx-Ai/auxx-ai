// apps/web/src/app/(protected)/app/custom/[slug]/dashboard/page.tsx
'use client'

import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { useParams } from 'next/navigation'
import { EntityDashboardPage } from '~/components/dashboard/ui/entity-dashboard-page'
import { useResource } from '~/components/resources'

/**
 * Generic custom-entity dashboard (plan 02) — one wiring covers every custom
 * entity def via the `ChartColumn` header button on the records page
 * (`RecordsView`).
 */
export default function CustomEntityDashboardPage() {
  const params = useParams<{ slug: string }>()
  const { resource } = useResource(params.slug)

  return (
    <MainPage>
      <MainPageHeader>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem
            title={resource?.plural ?? 'Records'}
            href={`/app/custom/${params.slug}`}
          />
          <MainPageBreadcrumbItem title='Dashboard' last />
        </MainPageBreadcrumb>
      </MainPageHeader>
      <EntityDashboardPage slug={params.slug} />
    </MainPage>
  )
}
