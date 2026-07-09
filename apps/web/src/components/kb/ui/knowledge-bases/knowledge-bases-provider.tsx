// apps/web/src/components/kb/ui/knowledge-bases/knowledge-bases-provider.tsx
'use client'

// Org-wide knowledge-base state for the `/app/kb` Knowledge Bases tab. Backs
// the card grid off `kb.list` directly (not the `useKnowledgeBases()` store
// hook — `/app/kb` never hydrates that store, see create-knowledge-base-button.tsx)
// and filters client-side. Each row is merged draft-over-live so an unpublished
// name/description edit shows immediately, matching kb-switcher.tsx.

import { mergeDraftOverLive } from '@auxx/lib/kb/client'
import { createContext, useContext, useMemo, useState } from 'react'
import { api } from '~/trpc/react'
import type { KnowledgeBase } from '../../store/knowledge-base-store'

interface KnowledgeBasesContextValue {
  knowledgeBases: KnowledgeBase[]
  isLoading: boolean
  searchQuery: string
  setSearchQuery: (query: string) => void
  refetch: () => void
}

const KnowledgeBasesContext = createContext<KnowledgeBasesContextValue | undefined>(undefined)

export function KnowledgeBasesProvider({ children }: { children: React.ReactNode }) {
  const [searchQuery, setSearchQuery] = useState('')
  const { data, isLoading, refetch } = api.kb.list.useQuery()

  const knowledgeBases = useMemo(() => {
    const all = (data ?? []).map((kb) => mergeDraftOverLive(kb) as KnowledgeBase)
    const q = searchQuery.trim().toLowerCase()
    if (!q) return all
    return all.filter(
      (kb) =>
        kb.name.toLowerCase().includes(q) || (kb.description?.toLowerCase().includes(q) ?? false)
    )
  }, [data, searchQuery])

  const value: KnowledgeBasesContextValue = {
    knowledgeBases,
    isLoading,
    searchQuery,
    setSearchQuery,
    refetch: () => void refetch(),
  }

  return <KnowledgeBasesContext.Provider value={value}>{children}</KnowledgeBasesContext.Provider>
}

export function useKnowledgeBasesList() {
  const context = useContext(KnowledgeBasesContext)
  if (context === undefined) {
    throw new Error('useKnowledgeBasesList must be used within a KnowledgeBasesProvider')
  }
  return context
}
