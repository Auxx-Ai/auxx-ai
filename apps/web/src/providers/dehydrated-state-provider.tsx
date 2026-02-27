// apps/web/src/providers/dehydrated-state-provider.tsx
'use client'

import type {
  DehydratedEnvironment,
  DehydratedOrganization,
  DehydratedState,
  DehydratedUser,
} from '@auxx/lib/dehydration'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'

/**
 * Context value with state and updater functions
 */
interface DehydratedStateContextValue {
  state: DehydratedState
  patchUser: (partial: Partial<DehydratedUser>) => void
  patchOrganization: (orgId: string, partial: Partial<DehydratedOrganization>) => void
  patchSettings: (orgId: string, settings: Record<string, any>) => void
  setOrganizationId: (orgId: string | null) => void
  replaceState: (next: DehydratedState) => void
}

/**
 * Context for dehydrated state
 */
const DehydratedStateContext = createContext<DehydratedStateContextValue | null>(null)

/**
 * Provider for dehydrated state
 * Receives initial state from server-side rendering, supports optimistic patches
 */
export function DehydratedStateProvider({
  children,
  initialState,
}: {
  children: ReactNode
  initialState: DehydratedState
}) {
  const [state, setState] = useState<DehydratedState>(initialState)

  // Sync on server re-render. Use a ref to compare by identity,
  // not by timestamp, to avoid the stale-timestamp-from-cache problem.
  const prevInitialRef = useRef(initialState)
  useEffect(() => {
    if (prevInitialRef.current !== initialState) {
      prevInitialRef.current = initialState
      setState(initialState)
    }
  }, [initialState])

  const patchUser = useCallback((partial: Partial<DehydratedUser>) => {
    setState((prev) => ({
      ...prev,
      user: prev.user ? { ...prev.user, ...partial } : prev.user,
      timestamp: Date.now(),
    }))
  }, [])

  const patchOrganization = useCallback(
    (orgId: string, partial: Partial<DehydratedOrganization>) => {
      setState((prev) => ({
        ...prev,
        organizations: prev.organizations.map((org) =>
          org.id === orgId ? { ...org, ...partial } : org
        ),
        timestamp: Date.now(),
      }))
    },
    []
  )

  const patchSettings = useCallback((orgId: string, settings: Record<string, any>) => {
    setState((prev) => ({
      ...prev,
      organizations: prev.organizations.map((org) =>
        org.id === orgId ? { ...org, settings: { ...org.settings, ...settings } } : org
      ),
      timestamp: Date.now(),
    }))
  }, [])

  const setOrganizationId = useCallback((orgId: string | null) => {
    setState((prev) => ({
      ...prev,
      organizationId: orgId,
      user: prev.user ? { ...prev.user, defaultOrganizationId: orgId } : prev.user,
      timestamp: Date.now(),
    }))
  }, [])

  const replaceState = useCallback((next: DehydratedState) => {
    setState(next)
  }, [])

  const contextValue: DehydratedStateContextValue = {
    state,
    patchUser,
    patchOrganization,
    patchSettings,
    setOrganizationId,
    replaceState,
  }

  return (
    <DehydratedStateContext.Provider value={contextValue}>
      {children}
    </DehydratedStateContext.Provider>
  )
}

/**
 * Hook to access the full dehydrated state context (state + updaters)
 * @throws Error if used outside DehydratedStateProvider
 */
export function useDehydratedStateContext(): DehydratedStateContextValue {
  const ctx = useContext(DehydratedStateContext)
  if (!ctx) {
    throw new Error('useDehydratedStateContext must be used within DehydratedStateProvider')
  }
  return ctx
}

/**
 * Hook to access full dehydrated state
 * @throws Error if used outside DehydratedStateProvider
 */
export function useDehydratedState(): DehydratedState {
  return useDehydratedStateContext().state
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
