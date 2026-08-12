// apps/web/src/components/apps/providers/apps-context.tsx
'use client'

import type { ClientMcpServer } from '@auxx/lib/agents/client'
import { createContext, type ReactNode, useContext } from 'react'
import type { Expand } from '~/lib/types'
import type { RouterOutputs } from '~/trpc/react'

export type AppInstallation = Expand<
  NonNullable<RouterOutputs['apps']['listInstalled']['installations']>[number]
>

export type AppConnection = NonNullable<RouterOutputs['apps']['listConnections']>[number]
/**
 * Represents an installed extension in the current organization.
 * Based on the actual API response from packages/services/src/app-installations/get-installed-apps.ts
 */
// export interface AppInstallation {
//   // Installation details
//   installationId: string
//   installationType: 'development' | 'production'
//   installedAt: Date

//   // App details
//   app: {
//     id: string
//     slug: string
//     title: string
//     description: string | null
//     avatarUrl: string | null
//     category: string | null
//   }

//   // Current version details
//   currentVersion: {
//     id: string
//     versionString: string
//     status: string
//     releasedAt: Date | null
//   } | null
// }

/**
 * Extensions context value containing list of installed apps and connections with loading state
 */
interface AppsContextValue {
  appInstallations: AppInstallation[]
  appConnections: AppConnection[]
  /**
   * Connected MCP servers (separate from app installations — they share none of the
   * per-installation infrastructure). Consumers opt in explicitly; see the builder catalog
   * and tool-meta resolver hooks.
   */
  mcpServers: ClientMcpServer[]
  isLoading: boolean
  /**
   * `appConnections` resolves on its own query, so it is still empty while
   * `isLoading` (installations) is already false. Consumers that read
   * "no connection exists" as an error state must gate on this flag or they
   * flash that error on every cold load.
   */
  isLoadingConnections: boolean
  isError: boolean
  /** Refetch installed apps. Call after installing/uninstalling an app. */
  refreshInstallations: () => Promise<void>
  /** Refetch MCP servers. Call after connecting/disconnecting/refreshing a server. */
  refreshMcpServers: () => Promise<void>
}

/**
 * Context for sharing list of installed extensions across the app
 */
const AppsContext = createContext<AppsContextValue | null>(null)

/**
 * Provides list of installed extensions to all children.
 * This context is populated by AppsProvider after fetching installations via tRPC.
 */
export function AppsContextProvider({
  appInstallations,
  appConnections,
  mcpServers,
  isLoading,
  isLoadingConnections,
  isError,
  refreshInstallations,
  refreshMcpServers,
  children,
}: {
  appInstallations: AppInstallation[]
  appConnections: AppConnection[]
  mcpServers: ClientMcpServer[]
  isLoading: boolean
  isLoadingConnections: boolean
  isError: boolean
  refreshInstallations: () => Promise<void>
  refreshMcpServers: () => Promise<void>
  children: ReactNode
}) {
  return (
    <AppsContext.Provider
      value={{
        appInstallations,
        appConnections,
        mcpServers,
        isLoading,
        isLoadingConnections,
        isError,
        refreshInstallations,
        refreshMcpServers,
      }}>
      {children}
    </AppsContext.Provider>
  )
}

/**
 * Hook to access installed extensions from any component.
 * @throws {Error} If used outside of AppsContextProvider
 */
export function useAppsContext() {
  const context = useContext(AppsContext)

  if (!context) {
    throw new Error('useAppsContext must be used within AppsContextProvider')
  }

  return context
}

/**
 * Same as {@link useAppsContext} but returns `null` outside the provider instead
 * of throwing. For shared components that also render outside `(protected)/app`
 * — the workflow viewer mounts the same nodes on pages with no AppsProvider.
 */
export function useOptionalAppsContext() {
  return useContext(AppsContext)
}
