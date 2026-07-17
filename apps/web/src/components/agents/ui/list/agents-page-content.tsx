// apps/web/src/components/agents/ui/list/agents-page-content.tsx
'use client'

import { ListPageScroll } from '@auxx/ui/components/list-page-scroll'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { ListSelectionProvider } from '~/components/list-selection'
import { AgentsBulkBar } from './agents-bulk-bar'
import { AgentsGridView } from './agents-grid-view'
import { AgentsSearchBar } from './agents-search-bar'
import { CreateAgentButton } from './create-agent-button'

export function AgentsPageContent() {
  return (
    <MainPage>
      <MainPageHeader action={<CreateAgentButton />}>
        <MainPageBreadcrumb>
          <MainPageBreadcrumbItem title='Kopilot' href='/app/kopilot/new' />
          <MainPageBreadcrumbItem title='Agents' />
        </MainPageBreadcrumb>
      </MainPageHeader>

      <MainPageContent>
        <ListSelectionProvider>
          <ListPageScroll
            toolbar={<AgentsSearchBar />}
            bodyClassName='flex-1 flex flex-col min-h-0'>
            <AgentsGridView />
          </ListPageScroll>
          <AgentsBulkBar />
        </ListSelectionProvider>
      </MainPageContent>
    </MainPage>
  )
}
