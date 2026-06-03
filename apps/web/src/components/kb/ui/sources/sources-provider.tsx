// apps/web/src/components/kb/ui/sources/sources-provider.tsx
'use client'

import { createContext, useContext, useMemo, useState } from 'react'
import { useDebounce } from '~/hooks/use-debounced-value'
import { api, type RouterOutputs } from '~/trpc/react'

export type KnowledgeSource = RouterOutputs['knowledgeSource']['list'][number]
export type SourceStatus = KnowledgeSource['status']
export type SourceStatusFilter = SourceStatus | 'all'

interface SourcesContextValue {
  items: KnowledgeSource[]
  isLoading: boolean
  isError: boolean

  searchQuery: string
  setSearchQuery: (query: string) => void
  selectedStatus: SourceStatusFilter
  setSelectedStatus: (status: SourceStatusFilter) => void

  refetch: () => void
}

const SourcesContext = createContext<SourcesContextValue | null>(null)

export function useSources() {
  const context = useContext(SourcesContext)
  if (!context) throw new Error('useSources must be used within SourcesProvider')
  return context
}

/**
 * Org-wide knowledge-sources state for the `/app/kb` Sources tab. Backs the card grid
 * off `knowledgeSource.list` and filters client-side (the list is small and unpaged).
 * Polls while any source is `syncing` so the card status dots stay live.
 */
export function SourcesProvider({ children }: { children: React.ReactNode }) {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedStatus, setSelectedStatus] = useState<SourceStatusFilter>('all')
  const debouncedSearch = useDebounce(searchQuery, 300)

  const { data, isLoading, isError, refetch } = api.knowledgeSource.list.useQuery(undefined, {
    // Keep status dots fresh while a sync is in flight; idle otherwise.
    refetchInterval: (query) =>
      (query.state.data ?? []).some((s) => s.status === 'syncing') ? 4000 : false,
  })

  const items = useMemo(() => {
    const all = data ?? []
    const q = debouncedSearch.trim().toLowerCase()
    return all.filter((source) => {
      if (selectedStatus !== 'all' && source.status !== selectedStatus) return false
      if (q && !source.name.toLowerCase().includes(q)) return false
      return true
    })
  }, [data, debouncedSearch, selectedStatus])

  const value: SourcesContextValue = {
    items,
    isLoading,
    isError,
    searchQuery,
    setSearchQuery,
    selectedStatus,
    setSelectedStatus,
    refetch,
  }

  return <SourcesContext.Provider value={value}>{children}</SourcesContext.Provider>
}
