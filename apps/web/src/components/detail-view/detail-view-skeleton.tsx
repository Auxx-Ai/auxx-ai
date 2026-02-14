// apps/web/src/components/detail-view/detail-view-skeleton.tsx
'use client'

import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { useDockStore } from '~/stores/dock-store'
import type { DetailViewSkeletonProps } from './types'

/**
 * DetailViewSkeleton - loading skeleton for detail view page
 */
export function DetailViewSkeleton({ label, backUrl }: DetailViewSkeletonProps) {
  const dockedWidth = useDockStore((state) => state.dockedWidth)

  return (
    <MainPage>
      <MainPageHeader>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title={label ?? 'Records'} href={backUrl} />
          <MainPageBreadcrumbItem title='Loading...' last />
        </MainPageBreadcrumb>
      </MainPageHeader>
      <MainPageContent
        dockedPanels={[
          {
            key: 'sidebar',
            content: (
              <div className='h-full'>
                {/* Card Header Skeleton */}
                <div className='flex gap-3 py-2 px-3 flex-row items-center justify-start border-b'>
                  <Skeleton className='size-10 rounded-lg' />
                  <div className='flex flex-col w-full gap-1'>
                    <Skeleton className='h-6 w-48' />
                    <Skeleton className='h-4 w-32' />
                  </div>
                </div>
                {/* Tabs Skeleton */}
                <div className='border-b px-2 py-1'>
                  <Skeleton className='h-7 w-32' />
                </div>
                {/* Fields Skeleton */}
                <div className='p-4 space-y-4'>
                  <Skeleton className='h-8 w-full' />
                  <Skeleton className='h-8 w-full' />
                  <Skeleton className='h-8 w-full' />
                  <Skeleton className='h-8 w-3/4' />
                </div>
              </div>
            ),
            width: dockedWidth,
          },
        ]}>
        {/* Main content skeleton */}
        <div className='flex flex-col h-full'>
          {/* Tabs skeleton */}
          <div className='border-b px-2 py-1 flex gap-2'>
            <Skeleton className='h-7 w-20' />
            <Skeleton className='h-7 w-20' />
            <Skeleton className='h-7 w-20' />
          </div>
          {/* Content skeleton */}
          <div className='p-6 space-y-4 flex-1'>
            <Skeleton className='h-12 w-full' />
            <Skeleton className='h-64 w-full' />
          </div>
        </div>
      </MainPageContent>
    </MainPage>
  )
}
