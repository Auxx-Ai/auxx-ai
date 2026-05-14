// apps/web/src/components/agents/ui/list/agents-search-bar.tsx
'use client'

import { Input } from '@auxx/ui/components/input'
import { Search } from 'lucide-react'
import { useAgentSearch } from '../../hooks/use-agent-search'

export function AgentsSearchBar() {
  const { search, setSearch } = useAgentSearch()
  return (
    <div className='relative max-w-md'>
      <Search className='absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground' />
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder='Search agents…'
        className='pl-8'
      />
    </div>
  )
}
