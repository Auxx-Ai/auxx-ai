// apps/web/src/components/dynamic-table/context/view-store-provider.tsx
'use client'

import { type ReactNode, useCallback } from 'react'
import { useViewStoreInit } from '../hooks/use-view-store-init'
import { useDynamicTableStore } from '../stores/dynamic-table-store'
import { useSelectionStore } from '../stores/selection-store'

interface ViewStoreProviderProps {
  children: ReactNode
}

/**
 * Provider that initializes the unified table store on app load.
 * Handles clearing store on logout/org switch.
 *
 * With the new unified DynamicTableStore, this initializes all slices at once:
 * - View slice: View metadata
 * - UI slice: UI configuration
 * - Filter slice: Filter state
 * - (selection-store is kept separate, per-table)
 */
export function ViewStoreProvider({ children }: ViewStoreProviderProps) {
  // Initialize the unified store
  useViewStoreInit()

  return <>{children}</>
}

/**
 * Hook to clear all table stores (call on logout or organization switch).
 * Clears: dynamic-table-store (all slices) and selection-store.
 */
export function useViewStoreClear() {
  const clearDynamicTableStore = useDynamicTableStore((state) => state.clearAll)
  const clearSelectionStore = useSelectionStore((state) => state.clearAll)

  return useCallback(() => {
    clearDynamicTableStore()
    clearSelectionStore()
  }, [clearDynamicTableStore, clearSelectionStore])
}
