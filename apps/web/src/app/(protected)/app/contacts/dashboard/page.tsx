// apps/web/src/app/(protected)/app/contacts/dashboard/page.tsx
'use client'

import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { EntityDashboardPage } from '~/components/dashboard/ui/entity-dashboard-page'

/**
 * Contacts entity dashboard (plan 02) — reached via the `ChartColumn` header
 * button on the contacts list page (`RecordsView`). The contacts layout is a
 * pass-through (no shared `MainPage`), so this route owns its own shell —
 * unlike tickets, whose layout already provides one for the RadioTab.
 */
export default function ContactsDashboardPage() {
  return (
    <MainPage>
      <MainPageHeader>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title='Contacts' href='/app/contacts' />
          <MainPageBreadcrumbItem title='Dashboard' last />
        </MainPageBreadcrumb>
      </MainPageHeader>
      <EntityDashboardPage slug='contacts' />
    </MainPage>
  )
}
