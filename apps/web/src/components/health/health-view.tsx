// apps/web/src/components/health/health-view.tsx
'use client'

import type { HealthIndicatorId } from '@auxx/lib/health/client'
import { Button } from '@auxx/ui/components/button'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
  MainPageSubheader,
} from '@auxx/ui/components/main-page'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { RefreshCw } from 'lucide-react'
import { parseAsString, useQueryState } from 'nuqs'
import { useDockedPanels } from '~/hooks/use-docked-panels'
import { api } from '~/trpc/react'
import { HealthDetailDrawer } from './health-detail-drawer'
import { HealthServiceCard } from './ui/health-service-card'

/**
 * Main health dashboard view.
 * Shows status cards for all services with docked detail drawer.
 */
export function HealthView() {
  const { data, isLoading, refetch, isFetching } = api.admin.health.getOverview.useQuery(
    undefined,
    { refetchOnWindowFocus: false }
  )

  /** Drawer state - synced to URL via ?indicator= param */
  const [selectedIndicator, setSelectedIndicator] = useQueryState(
    'indicator',
    parseAsString.withDefault('')
  )
  const isDrawerOpen = !!selectedIndicator

  /** Open detail drawer for an indicator */
  const handleCardClick = (id: HealthIndicatorId) => {
    setSelectedIndicator(id)
  }

  /** Close drawer */
  const handleDrawerOpenChange = (open: boolean) => {
    if (!open) setSelectedIndicator(null)
  }

  const { dockedPanels, overlays } = useDockedPanels([
    {
      key: 'health-detail',
      open: isDrawerOpen,
      content: (
        <HealthDetailDrawer
          indicatorId={selectedIndicator as HealthIndicatorId}
          open={isDrawerOpen}
          onOpenChange={handleDrawerOpenChange}
        />
      ),
    },
  ])

  return (
    <>
      <MainPage>
        <MainPageHeader>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title='Admin' href='/admin' />
            <MainPageBreadcrumbItem title='Health' />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent dockedPanels={dockedPanels}>
          <MainPageSubheader>
            <Button
              variant='outline'
              size='sm'
              onClick={() => refetch()}
              loading={isFetching}
              loadingText='Refreshing...'>
              <RefreshCw /> Refresh
            </Button>
          </MainPageSubheader>

          {isLoading ? (
            <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3 p-4'>
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className='h-24 w-full rounded-lg' />
              ))}
            </div>
          ) : (
            <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3 p-4'>
              {data?.services.map((service) => (
                <HealthServiceCard
                  key={service.id}
                  id={service.id}
                  label={service.label}
                  status={service.status}
                  onClick={() => handleCardClick(service.id)}
                />
              ))}
            </div>
          )}
        </MainPageContent>
      </MainPage>

      {overlays}
    </>
  )
}
