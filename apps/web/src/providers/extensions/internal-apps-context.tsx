// apps/web/src/providers/extensions/internal-apps-context.tsx
'use client'

import { createContext, type ReactNode, useContext, useRef } from 'react'
import { AppStore } from '~/lib/extensions/app-store'

/**
 * Internal apps context value containing the central AppStore
 */
interface InternalAppsContextValue {
  store: AppStore
}

/**
 * Context for sharing the AppStore instance across all extension-related components
 */
const InternalAppsContext = createContext<InternalAppsContextValue | null>(null)

/**
 * Provides the central AppStore to all extension-related components.
 * Creates a single AppStore instance that persists for the lifetime of the provider.
 *
 * The AppStore is the single source of truth for all extension state:
 * - Registered surfaces (actions, widgets, etc.)
 * - Extension assets
 * - Widget render states
 * - Trigger promises
 */
export function InternalAppsContextProvider({ children }: { children: ReactNode }) {
  // Create store once and persist across re-renders
  const storeRef = useRef<AppStore>(null)

  if (!storeRef.current) {
    storeRef.current = new AppStore()
    console.log('[Extensions] AppStore created')
  }

  return (
    <InternalAppsContext.Provider value={{ store: storeRef.current }}>
      {children}
    </InternalAppsContext.Provider>
  )
}

/**
 * Hook to access the AppStore from any component.
 * @throws {Error} If used outside of InternalAppsContextProvider
 */
export function useInternalAppsContext() {
  const context = useContext(InternalAppsContext)

  if (!context) {
    throw new Error('useInternalAppsContext must be used within InternalAppsContextProvider')
  }

  return context
}
