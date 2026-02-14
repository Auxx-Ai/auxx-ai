// apps/web/src/providers/extensions/extensions-context.tsx
'use client'

import { createContext, type ReactNode, useContext } from 'react'
import type { Expand } from '~/lib/types'
import type { RouterOutputs } from '~/trpc/react'

export type AppInstallation = Expand<
  NonNullable<RouterOutputs['apps']['listInstalled']['installations']>[number]
>
// import { type AppInstallationEntity as AppInstallation } from '@auxx/database/models'
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
 * Extensions context value containing list of installed apps with loading state
 */
interface ExtensionsContextValue {
  appInstallations: AppInstallation[]
  isLoading: boolean
  isError: boolean
}

/**
 * Context for sharing list of installed extensions across the app
 */
const ExtensionsContext = createContext<ExtensionsContextValue | null>(null)

/**
 * Provides list of installed extensions to all children.
 * This context is populated by ExtensionsProvider after fetching installations via tRPC.
 */
export function ExtensionsContextProvider({
  appInstallations,
  isLoading,
  isError,
  children,
}: {
  appInstallations: AppInstallation[]
  isLoading: boolean
  isError: boolean
  children: ReactNode
}) {
  return (
    <ExtensionsContext.Provider value={{ appInstallations, isLoading, isError }}>
      {children}
    </ExtensionsContext.Provider>
  )
}

/**
 * Hook to access installed extensions from any component.
 * @throws {Error} If used outside of ExtensionsContextProvider
 */
export function useExtensionsContext() {
  const context = useContext(ExtensionsContext)

  if (!context) {
    throw new Error('useExtensionsContext must be used within ExtensionsContextProvider')
  }

  return context
}
