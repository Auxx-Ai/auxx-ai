// apps/web/src/components/dynamic-table/context/view-store-provider.tsx
'use client'

import { type ReactNode } from 'react'
import { useViewStoreInit } from '../hooks/use-view-store-init'
import { useViewStore } from '../stores/view-store'

interface ViewStoreProviderProps {
  children: ReactNode
}

/**
 * Provider that initializes the view store on app load.
 * Also handles clearing the store on logout/org switch.
 */
export function ViewStoreProvider({ children }: ViewStoreProviderProps) {
  // Initialize view store with all views
  useViewStoreInit()

  return <>{children}</>
}

/**
 * Hook to clear view store (call on logout or organization switch)
 */
export function useViewStoreClear() {
  const clearAll = useViewStore((state) => state.clearAll)
  return clearAll
}
