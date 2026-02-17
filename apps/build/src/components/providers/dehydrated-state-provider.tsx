// apps/build/src/components/providers/dehydrated-state-provider.tsx
'use client'

import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react'
import type {
  BuildDehydratedState,
  DehydratedApp,
  DehydratedBuildEnvironment,
  DehydratedBuildUser,
  DehydratedDeveloperAccount,
  DehydratedDeveloperAccountInvitation,
  DehydratedOrganization,
} from '~/lib/dehydration'

/**
 * Context value with state and updater functions
 */
interface BuildDehydratedStateContextValue {
  state: BuildDehydratedState
  addAccount: (account: DehydratedDeveloperAccount) => void
  addApp: (app: DehydratedApp) => void
}

/**
 * Context for dehydrated state
 */
const BuildDehydratedStateContext = createContext<BuildDehydratedStateContextValue | null>(null)

/**
 * Provider for dehydrated state
 */
export function BuildDehydratedStateProvider({
  children,
  initialState,
}: {
  children: ReactNode
  initialState: BuildDehydratedState
}) {
  const [state, setState] = useState<BuildDehydratedState>(initialState)

  // Sync state when server re-renders with fresh data (e.g. after router.refresh())
  useEffect(() => {
    setState(initialState)
  }, [initialState.timestamp])

  const addAccount = useCallback((account: DehydratedDeveloperAccount) => {
    setState((prev) => ({
      ...prev,
      developerAccounts: [...prev.developerAccounts, account],
      timestamp: Date.now(),
    }))
  }, [])

  const addApp = useCallback((app: DehydratedApp) => {
    setState((prev) => ({
      ...prev,
      apps: [...prev.apps, app],
      timestamp: Date.now(),
    }))
  }, [])

  const contextValue: BuildDehydratedStateContextValue = {
    state,
    addAccount,
    addApp,
  }

  return (
    <BuildDehydratedStateContext.Provider value={contextValue}>
      {children}
    </BuildDehydratedStateContext.Provider>
  )
}

/**
 * Hook to access full dehydrated state context
 */
function useBuildDehydratedStateContext(): BuildDehydratedStateContextValue {
  const ctx = useContext(BuildDehydratedStateContext)
  if (!ctx) {
    throw new Error('useBuildDehydratedState must be used within BuildDehydratedStateProvider')
  }
  return ctx
}

/**
 * Hook to access full dehydrated state
 */
export function useBuildDehydratedState(): BuildDehydratedState {
  return useBuildDehydratedStateContext().state
}

/**
 * Hook to add a developer account to the dehydrated state
 */
export function useAddAccount(): (account: DehydratedDeveloperAccount) => void {
  return useBuildDehydratedStateContext().addAccount
}

/**
 * Hook to add an app to the dehydrated state
 */
export function useAddApp(): (app: DehydratedApp) => void {
  return useBuildDehydratedStateContext().addApp
}

/**
 * Hook to access authenticated user
 */
export function useAuthenticatedUser(): DehydratedBuildUser {
  return useBuildDehydratedState().authenticatedUser
}

/**
 * Hook to access all developer accounts
 */
export function useDeveloperAccounts(): DehydratedDeveloperAccount[] {
  return useBuildDehydratedState().developerAccounts
}

/**
 * Hook to access a specific developer account by slug
 */
export function useDeveloperAccount(slug: string): DehydratedDeveloperAccount | null {
  const accounts = useDeveloperAccounts()
  return accounts.find((a) => a.slug === slug) ?? null
}

/**
 * Hook to access all apps
 */
export function useApps(): DehydratedApp[] {
  return useBuildDehydratedState().apps
}

/**
 * Hook to access apps for a specific developer account
 */
export function useAccountApps(accountId: string): DehydratedApp[] {
  const allApps = useApps()
  return allApps.filter((app) => app.developerAccountId === accountId)
}

/**
 * Hook to access a specific app by slugs
 */
export function useApp(accountSlug: string, appSlug: string): DehydratedApp | null {
  const account = useDeveloperAccount(accountSlug)
  if (!account) return null

  const allApps = useApps()
  return allApps.find((a) => a.slug === appSlug && a.developerAccountId === account.id) ?? null
}

/**
 * Hook to access all organizations user is a member of
 */
export function useOrganizations(): DehydratedOrganization[] {
  return useBuildDehydratedState().organizations
}

/**
 * Hook to access pending invitations
 */
export function usePendingInvitations(): DehydratedDeveloperAccountInvitation[] {
  return useBuildDehydratedState().invitedDeveloperAccounts
}

/**
 * Hook to access environment config
 */
export function useBuildEnvironment(): DehydratedBuildEnvironment {
  return useBuildDehydratedState().environment
}
