// apps/web/src/components/dashboard/ui/dashboards-provider.tsx
'use client'

// Shared state for the dashboards index: the `dashboard.list` query plus the
// client-side search filter. Mirrors the workflows provider so the filter bar,
// list, and bulk bar can read one source without prop drilling through
// `ListPageScroll`.

import type { DashboardSummary } from '@auxx/lib/dashboards/client'
import { createContext, useContext, useMemo, useState } from 'react'
import { api } from '~/trpc/react'

interface DashboardsContextValue {
  dashboards: DashboardSummary[]
  isLoading: boolean
  searchQuery: string
  setSearchQuery: (query: string) => void
  refetch: () => void
}

const DashboardsContext = createContext<DashboardsContextValue | undefined>(undefined)

export function DashboardsProvider({ children }: { children: React.ReactNode }) {
  const [searchQuery, setSearchQuery] = useState('')
  const { data, isLoading, refetch } = api.dashboard.list.useQuery()

  const dashboards = useMemo(() => {
    const all = data ?? []
    const q = searchQuery.trim().toLowerCase()
    if (!q) return all
    return all.filter(
      (d) => d.name.toLowerCase().includes(q) || (d.description?.toLowerCase().includes(q) ?? false)
    )
  }, [data, searchQuery])

  const value: DashboardsContextValue = {
    dashboards,
    isLoading,
    searchQuery,
    setSearchQuery,
    refetch: () => void refetch(),
  }

  return <DashboardsContext.Provider value={value}>{children}</DashboardsContext.Provider>
}

export function useDashboards() {
  const context = useContext(DashboardsContext)
  if (context === undefined) {
    throw new Error('useDashboards must be used within a DashboardsProvider')
  }
  return context
}
