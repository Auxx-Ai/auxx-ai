// apps/web/src/components/dynamic-table/hooks/use-view-store-init.ts
'use client'

import { useEffect } from 'react'
import { api } from '~/trpc/react'
import { useViewStore } from '../stores/view-store-new'
import { useTableUIStore } from '../stores/table-ui-store'
import { useFilterStore } from '../stores/filter-store'
import { extractUIConfig } from '../utils/extract-ui-config'

/**
 * Hook to initialize all table stores with views from the API.
 * Should be called once at app initialization (in client-providers or app layout).
 *
 * This hook initializes:
 * 1. view-store: View metadata (name, isDefault, etc.)
 * 2. table-ui-store: UI config (sorting, columns, etc.)
 * 3. filter-store: Filter configuration
 */
export function useViewStoreInit() {
  const setAllViews = useViewStore((state) => state.setAllViews)
  const setInitialized = useViewStore((state) => state.setInitialized)
  const setError = useViewStore((state) => state.setError)
  const initialized = useViewStore((state) => state.initialized)

  // Fetch all views for the organization
  const { data: allViews, isLoading, error } = api.tableView.listAll.useQuery(undefined, {
    enabled: !initialized, // Only fetch if not already initialized
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
  })

  useEffect(() => {
    if (allViews && !initialized) {
      // 1. Initialize view-store (metadata)
      setAllViews(allViews)

      // 2. Initialize table-ui-store (UI config)
      const tableUIStore = useTableUIStore.getState()
      for (const view of allViews) {
        const uiConfig = extractUIConfig(view.config)
        tableUIStore.setViewConfig(view.id, uiConfig)
      }

      // 3. Initialize filter-store (filters)
      const filterStore = useFilterStore.getState()
      for (const view of allViews) {
        const filters = view.config.filters ?? []
        filterStore.setViewFilters(view.id, filters)
      }

      // Mark as initialized
      setInitialized(true)
    }
  }, [allViews, initialized, setAllViews, setInitialized])

  useEffect(() => {
    if (error) {
      setError(error instanceof Error ? error : new Error('Failed to load views'))
    }
  }, [error, setError])

  return { isLoading, error }
}
