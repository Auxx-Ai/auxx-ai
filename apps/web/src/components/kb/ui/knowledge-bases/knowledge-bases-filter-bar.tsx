// apps/web/src/components/kb/ui/knowledge-bases/knowledge-bases-filter-bar.tsx
'use client'

import { InputSearch } from '@auxx/ui/components/input-search'
import { ListBulkToggle } from '@auxx/ui/components/list-bulk-toggle'
import { ListToolbar, ListToolbarGroup } from '@auxx/ui/components/list-toolbar'
import { useBulkMode, useListSelection } from '~/components/list-selection'
import { useKnowledgeBasesList } from './knowledge-bases-provider'

export function KnowledgeBasesFilterBar() {
  const { searchQuery, setSearchQuery } = useKnowledgeBasesList()
  const bulkMode = useBulkMode()
  const setBulkMode = useListSelection((s) => s.setBulkMode)

  return (
    <ListToolbar>
      <InputSearch
        value={searchQuery}
        placeholder='Search knowledge bases...'
        onChange={(e) => setSearchQuery(e.target.value)}
      />

      <ListToolbarGroup align='end'>
        <ListBulkToggle active={bulkMode} onActiveChange={setBulkMode} />
      </ListToolbarGroup>
    </ListToolbar>
  )
}
