// apps/web/src/components/dynamic-table/hooks/use-view-store-init.ts
'use client'

import { useEffect } from 'react'
import { api } from '~/trpc/react'
import { useDynamicTableStore } from '../stores/dynamic-table-store'

/**
 * Hook to initialize the dynamic table store with views from the API.
 * Should be called once at app initialization (in client-providers or app layout).
 *
 * With the new unified store, this initializes all slices at once:
 * - View slice: View metadata (name, isDefault, etc.)
 * - UI slice: UI config (sorting, columns, etc.)
 * - Filter slice: Filter configuration
 */
export function useViewStoreInit() {
  const setAllViews = useDynamicTableStore((state) => state.setAllViews)
  const setInitialized = useDynamicTableStore((state) => state.setInitialized)
  const setError = useDynamicTableStore((state) => state.setError)
  const initialized = useDynamicTableStore((state) => state.initialized)

  // Fetch all views for the organization
  const { data: allViews, isLoading, error } = api.tableView.listAll.useQuery(undefined, {
    enabled: !initialized, // Only fetch if not already initialized
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
  })

  useEffect(() => {
    if (allViews && !initialized) {
      // Initialize all stores at once via setAllViews
      // This internally calls setViewConfig and setViewFilters for each view
      setAllViews(allViews)
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
