// apps/web/src/components/dynamic-table/hooks/use-view-store-init.ts
'use client'

import { useEffect } from 'react'
import { api } from '~/trpc/react'
import { useViewStore } from '../stores/view-store'

/**
 * Hook to initialize the view store with all table views.
 * Should be called once at app initialization (in client-providers or app layout).
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
