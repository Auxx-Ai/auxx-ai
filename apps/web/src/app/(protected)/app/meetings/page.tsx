// apps/web/src/app/(protected)/app/meetings/page.tsx
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
import { RecordsView } from '~/components/records'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { UpcomingMeetingsWidget } from '../_components/upcoming-meetings-widget'

/**
 * Meetings page — renders the shared RecordsView for the meetings resource.
 */
export default function MeetingsPage() {
  const { hasAccess } = useFeatureFlags()

  if (!hasAccess(FeatureKey.callRecordings)) {
    return (
      <MainPage>
        <MainPageHeader>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title='Meetings' href='/app/meetings' />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent>
          <EmptyState
            icon={Lock}
            title='Meetings Not Available'
            description='Upgrade your plan to access meetings and call recordings.'
            button={<div className='h-12' />}
          />
        </MainPageContent>
      </MainPage>
    )
  }

  return (
    <div className='space-y-6'>
      <div className='px-4 pt-4 sm:px-6'>
        <UpcomingMeetingsWidget />
      </div>
      <RecordsView slug='meetings' basePath='/app/meetings' />
    </div>
  )
}
