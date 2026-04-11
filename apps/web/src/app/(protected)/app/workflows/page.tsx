// apps/web/src/app/(protected)/app/workflows/page.tsx
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { Key, Lock, Workflow } from 'lucide-react'
import { useQueryState } from 'nuqs'
import { EmptyState } from '~/components/global/empty-state'
import { CredentialsProvider } from '~/components/workflow/credentials/credentials-provider'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { CreateWorkflowButton } from './_components/buttons/create-workflow-button'
import { WorkflowsFilterBar } from './_components/filters/workflows-filter-bar'
import { WorkflowsList } from './_components/lists/workflows-list'
import { WorkflowsProvider } from './_components/providers/workflows-provider'
import { WorkflowsStatsCards } from './_components/stats/workflows-stats-cards'
import { CredentialsTabContent } from './_components/tabs/credentials-tab-content'

function WorkflowsTabContent() {
  return (
    <>
      {/* Stats Cards */}
      <WorkflowsStatsCards />

      {/* Filters + Workflows List */}
      <ScrollArea className='flex-1 min-h-0 flex flex-col'>
        <div className='sticky top-0 z-10 backdrop-blur-sm shrink-0'>
          <WorkflowsFilterBar />
        </div>
        <div className='p-3 sm:p-6 flex-1 flex flex-col min-h-0'>
          <WorkflowsList />
        </div>
      </ScrollArea>
    </>
  )
}

function WorkflowsPageContent() {
  // const [activeTab, setActiveTab] = useState('workflows')
  const [activeTab, setActiveTab] = useQueryState('t', { defaultValue: 'workflows' })

  return (
    <MainPage>
      <MainPageHeader
        action={
          <div className='flex items-center gap-2'>
            {activeTab === 'workflows' ? <CreateWorkflowButton /> : null}
          </div>
        }>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title='Automation' href='/app/workflows' />
          <MainPageBreadcrumbItem title='Overview' last />
        </MainPageBreadcrumb>
      </MainPageHeader>

      <MainPageContent>
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className='flex-1 h-full flex flex-col'>
          <TabsList className='border-b w-full justify-start rounded-b-none bg-primary-150'>
            <TabsTrigger value='workflows' variant='outline'>
              <Workflow />
              Workflows
            </TabsTrigger>
            <TabsTrigger value='credentials' variant='outline'>
              <Key />
              Credentials
            </TabsTrigger>
          </TabsList>

          <TabsContent value='workflows' className='flex flex-col flex-1 min-h-0'>
            <WorkflowsTabContent />
          </TabsContent>

          <TabsContent value='credentials' className='flex flex-col flex-1 min-h-0'>
            <CredentialsTabContent />
          </TabsContent>
        </Tabs>
      </MainPageContent>
    </MainPage>
  )
}

export default function WorkflowsPage() {
  const { hasAccess } = useFeatureFlags()

  if (!hasAccess(FeatureKey.workflows)) {
    return (
      <MainPage>
        <MainPageHeader>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title='Automation' href='/app/workflows' />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent>
          <EmptyState
            icon={Lock}
            title='Workflows Not Available'
            description='Upgrade your plan to use workflows.'
            button={<div className='h-12' />}
          />
        </MainPageContent>
      </MainPage>
    )
  }

  return (
    <WorkflowsProvider>
      <CredentialsProvider>
        <WorkflowsPageContent />
      </CredentialsProvider>
    </WorkflowsProvider>
  )
}
