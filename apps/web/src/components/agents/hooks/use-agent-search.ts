// apps/web/src/components/agents/hooks/use-agent-search.ts
'use client'

import { useShallow } from 'zustand/shallow'
import { useAgentStore } from '../store/agent-store'

/** Read/write the in-memory search string used by the list page. */
export function useAgentSearch(): { search: string; setSearch: (s: string) => void } {
  return useAgentStore(
    useShallow((s) => ({
      search: s.search,
      setSearch: s.setSearch,
    }))
  )
}
