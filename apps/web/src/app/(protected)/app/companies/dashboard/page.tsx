// apps/web/src/app/(protected)/app/companies/dashboard/page.tsx
'use client'

import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { EntityDashboardPage } from '~/components/dashboard/ui/entity-dashboard-page'

/**
 * Companies entity dashboard (plan 02) — reached via the `ChartColumn` header
 * button on the companies list page (`RecordsView`). The companies layout is a
 * pass-through (no shared `MainPage`), so this route owns its own shell.
 */
export default function CompaniesDashboardPage() {
  return (
    <MainPage>
      <MainPageHeader>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title='Companies' href='/app/companies' />
          <MainPageBreadcrumbItem title='Dashboard' last />
        </MainPageBreadcrumb>
      </MainPageHeader>
      <EntityDashboardPage slug='companies' />
    </MainPage>
  )
}
