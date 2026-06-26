// apps/web/src/components/agents/ui/list/agents-search-bar.tsx
'use client'

import { InputSearch } from '@auxx/ui/components/input-search'
import { ListToolbar } from '@auxx/ui/components/list-toolbar'
import { useAgentSearch } from '../../hooks/use-agent-search'

export function AgentsSearchBar() {
  const { search, setSearch } = useAgentSearch()
  return (
    <ListToolbar>
      <InputSearch
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder='Search agents…'
      />
    </ListToolbar>
  )
}
