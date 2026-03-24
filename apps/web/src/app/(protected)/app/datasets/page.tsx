// apps/web/src/app/(protected)/app/datasets/page.tsx

'use client'

import { FeatureKey } from '@auxx/lib/permissions/client'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Lock } from 'lucide-react'
import {
  CreateDatasetButton,
  DatasetsEmptyState,
  DatasetsFilterBar,
  DatasetsGridView,
  DatasetsProvider,
  DatasetsStatsCards,
  DatasetsTableView,
  useDatasets,
} from '~/components/datasets'
import { EmptyState } from '~/components/global/empty-state'
import { useFeatureFlags } from '~/providers/feature-flag-provider'

/**
 * Main content component for the datasets page
 */
function DatasetsPageContent() {
  const { items, stats, isLoading, searchQuery, selectedStatus, viewMode } = useDatasets()

  return (
    <MainPage>
      <MainPageHeader action={<CreateDatasetButton />}>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title='Datasets' href='/app/datasets' />
          <MainPageBreadcrumbItem title='Overview' last />
        </MainPageBreadcrumb>
      </MainPageHeader>
      <MainPageContent>
        {/* Stats Cards */}
        <DatasetsStatsCards stats={stats} />

        {/* Filters + Datasets Content */}
        <ScrollArea className='flex-1 min-h-0 bg-muted @container'>
          <div className='sticky top-0 z-10 backdrop-blur-sm'>
            <DatasetsFilterBar />
          </div>
          {isLoading ? (
            <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 p-3'>
              {[...Array(8)].map((_, i) => (
                <div key={i} className='border rounded-lg p-4'>
                  <Skeleton className='h-4 w-3/4 mb-2' />
                  <Skeleton className='h-3 w-1/2 mb-4' />
                  <Skeleton className='h-20 w-full' />
                </div>
              ))}
            </div>
          ) : items.length === 0 ? (
            <DatasetsEmptyState searchQuery={searchQuery} selectedStatus={selectedStatus} />
          ) : viewMode === 'grid' ? (
            <DatasetsGridView />
          ) : (
            <DatasetsTableView />
          )}
        </ScrollArea>
      </MainPageContent>
    </MainPage>
  )
}

/**
 * Main datasets page with provider wrapper
 */
export default function DatasetsPage() {
  const { hasAccess } = useFeatureFlags()

  if (!hasAccess(FeatureKey.datasets)) {
    return (
      <MainPage>
        <MainPageHeader>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title='Datasets' href='/app/datasets' />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent>
          <EmptyState
            icon={Lock}
            title='Datasets Not Available'
            description='Upgrade your plan to use datasets.'
            button={<div className='h-12' />}
          />
        </MainPageContent>
      </MainPage>
    )
  }

  return (
    <DatasetsProvider>
      <DatasetsPageContent />
    </DatasetsProvider>
  )
}
