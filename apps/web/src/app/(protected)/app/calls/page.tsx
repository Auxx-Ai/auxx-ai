// apps/web/src/app/(protected)/app/calls/page.tsx
'use client'

import { FeatureKey } from '@auxx/lib/permissions/client'
import { Button } from '@auxx/ui/components/button'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { Lock, Plus } from 'lucide-react'
import { useState } from 'react'
import { CreateMeetingDialog, RecordingsList } from '~/components/calls'
import { EmptyState } from '~/components/global/empty-state'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { UpcomingMeetingsWidget } from '../_components/upcoming-meetings-widget'

function CallsPageContent() {
  const [createDialogOpen, setCreateDialogOpen] = useState(false)

  return (
    <MainPage>
      <MainPageHeader
        action={
          <Button variant='outline' size='sm' onClick={() => setCreateDialogOpen(true)}>
            <Plus />
            Create Meeting
          </Button>
        }>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title='Calls' href='/app/calls' />
          <MainPageBreadcrumbItem title='Recordings' last />
        </MainPageBreadcrumb>
      </MainPageHeader>

      {createDialogOpen && (
        <CreateMeetingDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />
      )}

      <MainPageContent>
        <div className='flex flex-col h-full min-h-0'>
          <UpcomingMeetingsWidget />
          <RecordingsList />
        </div>
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
