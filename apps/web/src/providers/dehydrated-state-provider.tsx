// apps/web/src/providers/dehydrated-state-provider.tsx
'use client'

import type {
  DehydratedEnvironment,
  DehydratedOrganization,
  DehydratedState,
  DehydratedUser,
} from '@auxx/lib/dehydration'
import { createContext, type ReactNode, useContext } from 'react'

/**
 * Context for dehydrated state
 */
const DehydratedStateContext = createContext<DehydratedState | null>(null)

/**
 * Provider for dehydrated state
 * Receives initial state from server-side rendering
 */
export function DehydratedStateProvider({
  children,
  initialState,
}: {
  children: ReactNode
  initialState: DehydratedState
}) {
  return (
    <DehydratedStateContext.Provider value={initialState}>
      {children}
    </DehydratedStateContext.Provider>
  )
}

/**
 * Hook to access full dehydrated state
 * @throws Error if used outside DehydratedStateProvider
 */
export function useDehydratedState(): DehydratedState {
  const ctx = useContext(DehydratedStateContext)
  if (!ctx) {
    throw new Error('useDehydratedState must be used within DehydratedStateProvider')
  }
  return ctx
}

/**
 * Hook to access dehydrated user data.
 * Returns undefined on unauthenticated pages (auth layout).
 */
export function useDehydratedUser(): DehydratedUser | undefined {
  return useDehydratedState().user
}

/**
 * Hook to access all dehydrated organizations
 */
export function useDehydratedOrganizations(): DehydratedOrganization[] {
  return useDehydratedState().organizations
}

/**
 * Hook to access a specific dehydrated organization by ID
 * @param organizationId - Organization ID to find
 * @returns Organization or null if not found
 */
export function useDehydratedOrganization(
  organizationId: string | null
): DehydratedOrganization | null {
  const orgs = useDehydratedOrganizations()
  if (!organizationId) return null
  return orgs.find((o) => o.id === organizationId) ?? null
}

/**
 * Hook to access environment configuration
 */
export function useEnv(): DehydratedEnvironment {
  return useDehydratedState().environment
}

/**
 * Get environment from dehydrated state (browser) or return undefined (SSR).
 * Use this in non-React contexts where hooks can't be called.
 */
export function getEnv(): DehydratedEnvironment | undefined {
  if (typeof window !== 'undefined') {
    return window.AUXX_DEHYDRATED_STATE?.environment
  }
  return undefined
}

/**
 * Hook to access current organization ID from dehydrated state
 */
export function useDehydratedOrganizationId(): string | null {
  return useDehydratedState().organizationId
}

/**
 * Hook to access settings catalog from dehydrated state
 */
export function useSettingsCatalog(): Record<string, any> {
  return useDehydratedState().settingsCatalog
}

/**
 * Hook to access current organization settings from dehydrated state
 */
export function useDehydratedSettings(): Record<string, any> {
  const organizationId = useDehydratedOrganizationId()
  const org = useDehydratedOrganization(organizationId)
  return org?.settings ?? {}
}
