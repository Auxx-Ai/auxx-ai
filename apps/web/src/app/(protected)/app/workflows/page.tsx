// apps/web/src/app/(protected)/app/workflows/page.tsx
'use client'

import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { Key, Settings, Workflow } from 'lucide-react'
import { useQueryState } from 'nuqs'
import { CredentialsProvider } from '~/components/workflow/credentials/credentials-provider'
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

      {/* Filters and View Options */}
      <WorkflowsFilterBar />

      {/* Workflows Content */}
      <div className='p-3 flex-1 overflow-y-auto'>
        <WorkflowsList />
      </div>
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
  return (
    <WorkflowsProvider>
      <CredentialsProvider>
        <WorkflowsPageContent />
      </CredentialsProvider>
    </WorkflowsProvider>
  )
}
