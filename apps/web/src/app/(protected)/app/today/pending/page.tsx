// apps/web/src/app/(protected)/app/today/pending/page.tsx
'use client'

import { FeatureKey } from '@auxx/lib/permissions/client'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { Lock } from 'lucide-react'
import { EmptyState } from '~/components/global/empty-state'
import { PendingSendsPage } from '~/components/today/pending-page'
import { useFeatureFlags } from '~/providers/feature-flag-provider'

export default function PendingSendsRoute() {
  const { hasAccess } = useFeatureFlags()

  if (!hasAccess(FeatureKey.todayInbox)) {
    return (
      <MainPage>
        <MainPageHeader>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title='Today' href='/app/today' />
            <MainPageBreadcrumbItem title='Pending sends' last />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent>
          <EmptyState
            icon={Lock}
            title='Today Inbox Not Available'
            description='The AI Today Inbox is disabled for your organization.'
            button={<div className='h-12' />}
          />
        </MainPageContent>
      </MainPage>
    )
  }

  return <PendingSendsPage />
}
