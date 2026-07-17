// apps/web/src/components/dashboard/ui/dashboards-list-view.tsx
'use client'

// Dashboards index: a ListCard grid over `dashboard.list`, gated by the
// `dashboards` feature flag. Follows the workflows page shape — a
// DashboardsProvider for filter/data, a ListSelectionProvider + ListPageScroll
// with a filter-bar toolbar, and a floating bulk bar. Backed entirely by
// shipped plan-02 procedures — no dependency on the aggregate engine.

import { FeatureKey } from '@auxx/lib/permissions/client'
import { ListPageScroll } from '@auxx/ui/components/list-page-scroll'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { Lock } from 'lucide-react'
import { EmptyState } from '~/components/global/empty-state'
import { ListSelectionProvider } from '~/components/list-selection'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { CreateDashboardButton } from './create-dashboard-button'
import { DashboardsBulkBar } from './dashboards-bulk-bar'
import { DashboardsFilterBar } from './dashboards-filter-bar'
import { DashboardsList } from './dashboards-list'
import { DashboardsProvider } from './dashboards-provider'

function DashboardsPageContent() {
  return (
    <MainPage>
      <MainPageHeader action={<CreateDashboardButton registerShortcut />}>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title='Dashboards' href='/app/dashboards' />
        </MainPageBreadcrumb>
      </MainPageHeader>

      <MainPageContent>
        <ListSelectionProvider>
          <ListPageScroll
            toolbar={<DashboardsFilterBar />}
            bodyClassName='flex-1 flex flex-col min-h-0'>
            <DashboardsList />
          </ListPageScroll>
          <DashboardsBulkBar />
        </ListSelectionProvider>
      </MainPageContent>
    </MainPage>
  )
}

export function DashboardsListView() {
  const { hasAccess } = useFeatureFlags()

  if (!hasAccess(FeatureKey.dashboards)) {
    return (
      <MainPage>
        <MainPageHeader>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title='Dashboards' href='/app/dashboards' />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent>
          <EmptyState
            icon={Lock}
            title='Dashboards not available'
            description='Upgrade your plan to build dashboards.'
            button={<div className='h-12' />}
          />
        </MainPageContent>
      </MainPage>
    )
  }

  return (
    <DashboardsProvider>
      <DashboardsPageContent />
    </DashboardsProvider>
  )
}
