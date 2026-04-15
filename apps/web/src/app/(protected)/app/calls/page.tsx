// apps/web/src/app/(protected)/app/calls/page.tsx
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
import { Lock } from 'lucide-react'
import { RecordingsList } from '~/components/calls'
import { EmptyState } from '~/components/global/empty-state'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { UpcomingMeetingsWidget } from '../_components/upcoming-meetings-widget'

function CallsPageContent() {
  return (
    <MainPage>
      <MainPageHeader>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title='Calls' href='/app/calls' />
          <MainPageBreadcrumbItem title='Recordings' last />
        </MainPageBreadcrumb>
      </MainPageHeader>

      <MainPageContent>
        <ScrollArea className='flex-1 min-h-0 flex flex-col'>
          <UpcomingMeetingsWidget />
          <div className='p-3 sm:p-6 flex-1 flex flex-col min-h-0'>
            <RecordingsList />
          </div>
        </ScrollArea>
      </MainPageContent>
    </MainPage>
  )
}

export default function CallsPage() {
  const { hasAccess } = useFeatureFlags()

  if (!hasAccess(FeatureKey.callRecordings)) {
    return (
      <MainPage>
        <MainPageHeader>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title='Calls' href='/app/calls' />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent>
          <EmptyState
            icon={Lock}
            title='Calls Not Available'
            description='Upgrade your plan to access meetings and call recordings.'
            button={<div className='h-12' />}
          />
        </MainPageContent>
      </MainPage>
    )
  }

  return <CallsPageContent />
}
