// apps/web/src/components/kb/ui/knowledge-bases/knowledge-bases-provider.tsx
'use client'

// Org-wide knowledge-base state for the `/app/kb` Knowledge Bases tab. Backs
// the card grid off `kb.list` directly (not the `useKnowledgeBases()` store
// hook — `/app/kb` never hydrates that store, see create-knowledge-base-button.tsx)
// and filters client-side. Each row is merged draft-over-live so an unpublished
// name/description edit shows immediately, matching kb-switcher.tsx.

import {
  isSystemProvisionedKnowledgeBase,
  type KBDraftSettings,
  mergeDraftOverLive,
} from '@auxx/lib/kb/client'
import { createContext, useContext, useMemo, useState } from 'react'
import { api } from '~/trpc/react'
import type { KnowledgeBase } from '../../store/knowledge-base-store'

interface KnowledgeBasesContextValue {
  knowledgeBases: KnowledgeBase[]
  isLoading: boolean
  /**
   * Whether the org's AI Memory KB (`kind: 'learned'`) is already in this list.
   *
   * Derived from the UNFILTERED response on purpose — the search box narrows
   * `knowledgeBases`, and deriving this from the narrowed array would make the
   * standalone AI Memory card blink back into existence the moment a query
   * excluded it. See `ai-memory-section.tsx` (plan v3/06 P4).
   */
  hasLearnedKnowledgeBase: boolean
  /**
   * Whether this KB is platform-provisioned and must not offer Delete
   * (plan v3/06 P4). Exposed as an id lookup because the bulk bar holds
   * selection **ids** and never the rows — and the tile and the bulk bar
   * disagreeing about the same KB is exactly the drift the shared
   * `RecordActionsMenu` work existed to remove.
   */
  isSystemProvisioned: (id: string) => boolean
  searchQuery: string
  setSearchQuery: (query: string) => void
  refetch: () => void
}

const KnowledgeBasesContext = createContext<KnowledgeBasesContextValue | undefined>(undefined)

export function KnowledgeBasesProvider({ children }: { children: React.ReactNode }) {
  const [searchQuery, setSearchQuery] = useState('')
  const { data, isLoading, refetch } = api.kb.list.useQuery()

  const knowledgeBases = useMemo(() => {
    const all = (data ?? []).map(
      (kb) =>
        mergeDraftOverLive({
          ...kb,
          // `draftSettings` is a jsonb column, so Drizzle hands it back as `unknown`.
          draftSettings: kb.draftSettings as KBDraftSettings | null,
        }) as KnowledgeBase
    )
    const q = searchQuery.trim().toLowerCase()
    if (!q) return all
    return all.filter(
      (kb) =>
        kb.name.toLowerCase().includes(q) || (kb.description?.toLowerCase().includes(q) ?? false)
    )
  }, [data, searchQuery])

  const systemProvisionedIds = useMemo(
    () =>
      new Set(
        (data ?? []).filter((kb) => isSystemProvisionedKnowledgeBase(kb.kind)).map((kb) => kb.id)
      ),
    [data]
  )
  const hasLearnedKnowledgeBase = useMemo(
    () => (data ?? []).some((kb) => kb.kind === 'learned'),
    [data]
  )

  const value: KnowledgeBasesContextValue = {
    knowledgeBases,
    isLoading,
    hasLearnedKnowledgeBase,
    isSystemProvisioned: (id: string) => systemProvisionedIds.has(id),
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
