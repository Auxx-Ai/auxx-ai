// apps/web/src/components/fields/display-only-provider.tsx

import type { ResourceField } from '@auxx/lib/resources/client'
import { createContext, type ReactNode, useContext } from 'react'

/**
 * Minimal context value for display-only field rendering.
 * Provides only the data needed to render field values without editing capabilities.
 */
interface DisplayOnlyContextValue {
  /** Field definition (type, options, name, etc.) */
  field: ResourceField
  /** Raw field value to display */
  value: any
}

const DisplayOnlyContext = createContext<DisplayOnlyContextValue | undefined>(undefined)

/**
 * Props for DisplayOnlyProvider
 */
interface DisplayOnlyProviderProps {
  /** Field definition */
  field: ResourceField
  /** Raw field value */
  value: any
  children: ReactNode
}

/**
 * Lightweight provider for display-only field rendering.
 * Use this when you need to render field values without store integration
 * or editing capabilities (e.g., in preview panels, read-only views).
 */
export function DisplayOnlyProvider({ field, value, children }: DisplayOnlyProviderProps) {
  const contextValue: DisplayOnlyContextValue = { field, value }
  return <DisplayOnlyContext.Provider value={contextValue}>{children}</DisplayOnlyContext.Provider>
}

/**
 * Hook to access display-only context.
 * @throws Error if used outside of a DisplayOnlyProvider
 */
export function useDisplayOnlyContext() {
  const ctx = useContext(DisplayOnlyContext)
  if (!ctx) {
    throw new Error('useDisplayOnlyContext must be used within a DisplayOnlyProvider')
  }
  return ctx
}
