// apps/web/src/app/(protected)/app/workflows/page.tsx
'use client'

import { FeatureKey } from '@auxx/lib/permissions/client'
import { ListPageScroll } from '@auxx/ui/components/list-page-scroll'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { Lock, SendHorizonal, Workflow } from 'lucide-react'
import { useQueryState } from 'nuqs'
import { EmptyState } from '~/components/global/empty-state'
import { CommandAction, CommandContext } from '~/components/kbar/contextual'
import { useCommandPaletteStore } from '~/components/kbar/store'
import { ListSelectionProvider } from '~/components/list-selection'
import { CreateSequenceButton } from '~/components/sequences/ui/list/create-sequence-button'
import { SequencesList } from '~/components/sequences/ui/list/sequences-list'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { CreateWorkflowButton } from './_components/buttons/create-workflow-button'
import { WorkflowsFilterBar } from './_components/filters/workflows-filter-bar'
import { WorkflowsBulkBar } from './_components/lists/workflows-bulk-bar'
import { WorkflowsList } from './_components/lists/workflows-list'
import { WorkflowsProvider } from './_components/providers/workflows-provider'
import { WorkflowsStatsCards } from './_components/stats/workflows-stats-cards'

/**
 * `/app/workflows` landing chrome — a `Workflows | Sequences` tab strip
 * (mirrors `/app/kb`'s `KBLandingShell`, Sequences plan §16). The `t` query
 * param persists the active tab across refresh/deep-link. `workflows` is the
 * pre-existing page body (stats cards + filter bar + list + bulk bar),
 * unchanged aside from being moved inside its `TabsContent`; `sequences` is
 * the new list.
 */
function WorkflowsPageContent() {
  const [tab, setTab] = useQueryState('t', { defaultValue: 'workflows' })
  const { hasAccess } = useFeatureFlags()
  const sequencesEnabled = hasAccess(FeatureKey.sequences)
  const activeTab = sequencesEnabled && tab === 'sequences' ? 'sequences' : 'workflows'

  return (
    <MainPage>
      <CommandContext kind='page' label='Automation'>
        <CommandAction
          label='Go to Workflows'
          icon='workflow'
          keywords='workflows tab view automation'
          priority={2}
          perform={() => {
            useCommandPaletteStore.getState().close()
            void setTab('workflows')
          }}
        />
        {sequencesEnabled && (
          <CommandAction
            label='Go to Sequences'
            icon='send'
            keywords='sequences tab view cadence email outreach'
            priority={1}
            perform={() => {
              useCommandPaletteStore.getState().close()
              void setTab('sequences')
            }}
          />
        )}
      </CommandContext>

      <MainPageHeader
        action={activeTab === 'sequences' ? <CreateSequenceButton /> : <CreateWorkflowButton />}>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title='Automation' href='/app/workflows' last />
        </MainPageBreadcrumb>
      </MainPageHeader>

      <MainPageContent>
        <Tabs value={activeTab} onValueChange={setTab} className='flex-1 h-full flex flex-col'>
          <TabsList className='border-b w-full justify-start rounded-b-none bg-primary-150'>
            <TabsTrigger value='workflows' variant='outline'>
              <Workflow />
              Workflows
            </TabsTrigger>
            {sequencesEnabled && (
              <TabsTrigger value='sequences' variant='outline'>
                <SendHorizonal />
                Sequences
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value='workflows' className='flex flex-col flex-1 min-h-0'>
            {/* Stats Cards */}
            <WorkflowsStatsCards />

            {/* Filters + Workflows List */}
            <ListSelectionProvider>
              <ListPageScroll
                toolbar={<WorkflowsFilterBar />}
                bodyClassName='flex-1 flex flex-col min-h-0'>
                <WorkflowsList />
              </ListPageScroll>
              <WorkflowsBulkBar />
            </ListSelectionProvider>
          </TabsContent>

          {sequencesEnabled && (
            <TabsContent value='sequences' className='flex flex-col flex-1 min-h-0'>
              <SequencesList />
            </TabsContent>
          )}
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
      <WorkflowsPageContent />
    </WorkflowsProvider>
  )
}
