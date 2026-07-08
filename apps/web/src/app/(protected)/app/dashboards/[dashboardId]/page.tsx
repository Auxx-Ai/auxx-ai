// apps/web/src/app/(protected)/app/dashboards/[dashboardId]/page.tsx

'use client'

import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { AlertTriangle } from 'lucide-react'
import { use } from 'react'
import { DashboardDetailView } from '~/components/dashboard/ui/dashboard-detail-view'
import { EmptyState } from '~/components/global/empty-state'
import { api } from '~/trpc/react'

interface DashboardDetailPageProps {
  params: Promise<{ dashboardId: string }>
}

/** Dashboard detail — view + edit the versioned widget grid. See plans/dashboard/08. */
export default function DashboardDetailPage({ params }: DashboardDetailPageProps) {
  const { dashboardId } = use(params)
  const dashboard = api.dashboard.get.useQuery({ id: dashboardId })

  if (dashboard.isError || (!dashboard.isLoading && !dashboard.data)) {
    return (
      <MainPage>
        <MainPageHeader>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title='Dashboards' href='/app/dashboards' />
            <MainPageBreadcrumbItem title='Not found' last />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent>
          <EmptyState
            icon={AlertTriangle}
            title='Dashboard not found'
            description='This dashboard does not exist or you do not have access to it.'
            button={<div className='h-12' />}
          />
        </MainPageContent>
      </MainPage>
    )
  }

  if (dashboard.isLoading || !dashboard.data) {
    return (
      <MainPage loading>
        <MainPageHeader>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title='Dashboards' href='/app/dashboards' />
            <MainPageBreadcrumbItem title='Loading…' last />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent>
          <div className='h-full w-full animate-pulse bg-muted/20' />
        </MainPageContent>
      </MainPage>
    )
  }

  return <DashboardDetailView dashboard={dashboard.data} />
}
