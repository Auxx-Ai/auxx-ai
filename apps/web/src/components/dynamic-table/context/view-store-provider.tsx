// apps/web/src/components/dynamic-table/context/view-store-provider.tsx
'use client'

import { type ReactNode, useCallback } from 'react'
import { useViewStoreInit } from '../hooks/use-view-store-init'
import { useViewStore } from '../stores/view-store'
import { useTableUIStore } from '../stores/table-ui-store'
import { useFilterStore } from '../stores/filter-store'
import { useSelectionStore } from '../stores/selection-store'

interface ViewStoreProviderProps {
  children: ReactNode
}

/**
 * Provider that initializes all table stores on app load.
 * Handles clearing stores on logout/org switch.
 *
 * This provider initializes:
 * - view-store: View metadata
 * - table-ui-store: UI configuration
 * - filter-store: Filter state
 * - (selection-store is not initialized here, it's per-table)
 */
export function ViewStoreProvider({ children }: ViewStoreProviderProps) {
  // Initialize all view-related stores
  useViewStoreInit()

  return <>{children}</>
}

/**
 * Hook to clear all table stores (call on logout or organization switch).
 * Clears: view-store, table-ui-store, filter-store, selection-store.
 */
export function useViewStoreClear() {
  const clearViewStore = useViewStore((state) => state.clearAll)
  const clearTableUIStore = useTableUIStore((state) => state.clearAll)
  const clearFilterStore = useFilterStore((state) => state.clearAll)
  const clearSelectionStore = useSelectionStore((state) => state.clearAll)

  return useCallback(() => {
    clearViewStore()
    clearTableUIStore()
    clearFilterStore()
    clearSelectionStore()
  }, [clearViewStore, clearTableUIStore, clearFilterStore, clearSelectionStore])
}
