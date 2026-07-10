// apps/web/src/components/kb/ui/knowledge-bases/knowledge-bases-tab.tsx
'use client'

import { ListPageScroll } from '@auxx/ui/components/list-page-scroll'
import { ListSelectionProvider } from '~/components/list-selection'
import { AiMemorySection } from '../memory/ai-memory-section'
import { KnowledgeBasesBulkBar } from './knowledge-bases-bulk-bar'
import { KnowledgeBasesFilterBar } from './knowledge-bases-filter-bar'
import { KnowledgeBasesList } from './knowledge-bases-list'
import { KnowledgeBasesProvider } from './knowledge-bases-provider'

/** Content for the `/app/kb` Knowledge Bases tab — grid of all org KBs. */
export function KnowledgeBasesTab() {
  return (
    <KnowledgeBasesProvider>
      <ListSelectionProvider>
        <ListPageScroll
          toolbar={<KnowledgeBasesFilterBar />}
          bodyClassName='flex-1 flex flex-col min-h-0'>
          <KnowledgeBasesList />
          <AiMemorySection />
        </ListPageScroll>
        <KnowledgeBasesBulkBar />
      </ListSelectionProvider>
    </KnowledgeBasesProvider>
  )
}
