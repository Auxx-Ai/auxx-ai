// apps/web/src/components/detail-view/detail-view-not-found.tsx
'use client'

import { useRouter } from 'next/navigation'
import { Button } from '@auxx/ui/components/button'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import type { DetailViewNotFoundProps } from './types'

/**
 * DetailViewNotFound - not found state for detail view page
 */
export function DetailViewNotFound({ label, backUrl }: DetailViewNotFoundProps) {
  const router = useRouter()

  return (
    <MainPage>
      <MainPageHeader>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title={label ?? 'Records'} href={backUrl} />
          <MainPageBreadcrumbItem title="Not Found" last />
        </MainPageBreadcrumb>
      </MainPageHeader>
      <MainPageContent>
        <div className="flex flex-col items-center justify-center h-full gap-4">
          <h1 className="text-2xl font-bold">Record Not Found</h1>
          <p className="text-muted-foreground text-center max-w-md">
            The requested record could not be found. It may have been deleted or you may not have
            permission to view it.
          </p>
          <Button onClick={() => router.push(backUrl)}>Return to List</Button>
        </div>
      </MainPageContent>
    </MainPage>
  )
}
