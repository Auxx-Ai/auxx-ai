// apps/web/src/app/(protected)/app/dashboards/[dashboardId]/page.tsx

'use client'

import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { AlertTriangle } from 'lucide-react'
import { use } from 'react'
import { DashboardDetailView } from '~/components/dashboard/ui/dashboard-detail-view'
import { MainPageLoading, MainPageNotFound } from '~/components/global/main-page-states'
import { api } from '~/trpc/react'

interface DashboardDetailPageProps {
  params: Promise<{ dashboardId: string }>
}

/**
 * Dashboard detail — view + edit the versioned widget grid. Owns the
 * standalone `MainPage` shell (breadcrumb "Dashboards"); `DashboardDetailView`
 * contributes the action cluster and the dashboard-switcher breadcrumb tail
 * via `MainPageAction`/`MainPageCrumbs`. See plans/dashboard/08.
 */
export default function DashboardDetailPage({ params }: DashboardDetailPageProps) {
  const { dashboardId } = use(params)
  const dashboard = api.dashboard.get.useQuery({ id: dashboardId })

  const isNotFound = dashboard.isError || (!dashboard.isLoading && !dashboard.data)

  return (
    <MainPage>
      <MainPageHeader>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title='Dashboards' href='/app/dashboards' />
        </MainPageBreadcrumb>
      </MainPageHeader>

      {isNotFound ? (
        <MainPageNotFound
          icon={AlertTriangle}
          title='Dashboard not found'
          description='This dashboard does not exist or you do not have access to it.'
        />
      ) : dashboard.isLoading || !dashboard.data ? (
        <MainPageLoading />
      ) : (
        <DashboardDetailView dashboard={dashboard.data} />
      )}
    </MainPage>
  )
}
