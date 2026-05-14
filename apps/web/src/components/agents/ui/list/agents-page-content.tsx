// apps/web/src/components/agents/ui/list/agents-page-content.tsx
'use client'

import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { AgentsGridView } from './agents-grid-view'
import { AgentsSearchBar } from './agents-search-bar'
import { CreateAgentButton } from './create-agent-button'

export function AgentsPageContent() {
  return (
    <MainPage>
      <MainPageHeader action={<CreateAgentButton />}>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title='Kopilot' href='/app/kopilot/new' />
          <MainPageBreadcrumbItem title='Agents' last />
        </MainPageBreadcrumb>
      </MainPageHeader>

      <MainPageContent>
        <ScrollArea className='flex-1 min-h-0 flex flex-col'>
          <div className='sticky top-0 z-10 backdrop-blur-sm shrink-0 px-3 sm:px-6 pt-3 pb-2'>
            <AgentsSearchBar />
          </div>
          <div className='p-3 sm:p-6 flex-1 flex flex-col min-h-0'>
            <AgentsGridView />
          </div>
        </ScrollArea>
      </MainPageContent>
    </MainPage>
  )
}
