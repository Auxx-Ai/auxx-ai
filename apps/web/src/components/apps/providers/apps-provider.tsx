// apps/web/src/components/apps/providers/apps-provider.tsx
'use client'

import type { ClientMcpServer } from '@auxx/lib/agents/client'
import { toastError } from '@auxx/ui/components/toast'
import { usePathname } from 'next/navigation'
import {
  Fragment,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { AssetsDataHandler } from '~/components/apps/host/data-handlers/assets-data-handler'
import { DialogDataHandler } from '~/components/apps/host/data-handlers/dialog-data-handler'
import { RecordDataHandler } from '~/components/apps/host/data-handlers/record-data-handler'
import { RenderDataHandler } from '~/components/apps/host/data-handlers/render-data-handler'
import { SurfacesDataHandler } from '~/components/apps/host/data-handlers/surfaces-data-handler'
import { TriggerDataHandler } from '~/components/apps/host/data-handlers/trigger-data-handler'
import { ErrorBoundary } from '~/components/apps/host/error-boundary'
import { MessageClientWrapper } from '~/components/apps/host/message-client-wrapper'
import {
  type ConnectionExpiredEvent,
  connectionExpiredEmitter,
} from '~/components/apps/runtime/connection-expired-emitter'
import { ConnectionExpiredDialog } from '~/components/apps/ui/connection-expired-dialog'
import { useDehydratedOrganizationId } from '~/providers/dehydrated-state-provider'
import { ORG_STATIC_STALE_TIME } from '~/trpc/query-client'
import { api } from '~/trpc/react'
import { AppDataHandlerContextProvider } from './app-data-handler-context'
import { AppsContextProvider } from './apps-context'
import { InternalAppsContextProvider } from './internal-apps-context'

/**
 * Props for AppsProvider
 */
interface AppsProviderProps {
  children: ReactNode
}

/**
 * Main orchestrator for extension loading and management.
 *
 * 1. Fetches installed extensions for organization via tRPC
 * 2. Creates AppStore (via InternalAppsContextProvider) - single instance for all extensions
 * 3. Creates MessageClient for each extension (Plan 3)
 * 4. Sets up data handlers for each extension (Plan 4):
 *    - SurfacesDataHandler - listens for surface registration
 *    - AssetsDataHandler - listens for asset registration
 *    - RenderDataHandler - listens for render updates
 *    - TriggerDataHandler - listens for trigger completion
 *    - DialogDataHandler - listens for dialog render/unrender
 * 5. Provides list of installed extensions to children via AppsContextProvider
 * 6. Renders children with extension infrastructure available
 *
 * Note: This component must be rendered in a client component tree since it uses React Query.
 */
export function AppsProvider({ children }: AppsProviderProps) {
  const organizationId = useDehydratedOrganizationId()
  const pathname = usePathname()

  // Fetch installed apps for this organization
  // Note: organizationId is retrieved from session in the tRPC procedure
  const {
    data: result,
    isLoading,
    error,
  } = api.apps.listInstalled.useQuery(
    {
      // type filter is optional - omitting it returns all installations (both dev and production)
    },
    { staleTime: ORG_STATIC_STALE_TIME }
  )

  // Always provide installations (empty during loading)
  const installations = result?.installations || []

  const utils = api.useUtils()

  const refreshInstallations = useCallback(async () => {
    await utils.apps.listInstalled.invalidate()
  }, [utils])

  const { data: connectionsResult } = api.apps.listConnections.useQuery(undefined, {
    staleTime: ORG_STATIC_STALE_TIME,
  })
  const connections = connectionsResult ?? []

  // MCP servers — pure data, mapped to the client-safe `ClientMcpServer` shape the builder
  // catalog + tool-meta resolvers consume. They never enter the per-installation infrastructure.
  const { data: mcpResult } = api.mcp.list.useQuery()
  const mcpServers = useMemo<ClientMcpServer[]>(
    () =>
      (mcpResult ?? []).map((server) => ({
        serverId: server.serverId,
        slug: server.slug,
        name: server.name,
        description: server.description,
        iconUrl: server.icon?.iconId ?? null,
        toolsetSlug: server.toolsetSlug,
        connectionPresent: server.connectionPresent,
        needsReconnect: server.needsReconnect,
        lastSyncError: server.lastSyncError,
        tools: server.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          readOnlyHint: tool.readOnlyHint,
          trusted: tool.trusted,
          outputsJsonSchema: tool.outputSchema,
        })),
      })),
    [mcpResult]
  )

  const refreshMcpServers = useCallback(async () => {
    await utils.mcp.list.invalidate()
  }, [utils])

  // Show error toast if loading failed
  if (error) {
    toastError({
      title: 'Extensions unavailable',
      description: 'Failed to load extensions. Core features still available.',
    })
  }

  // State for connection expired dialog
  const [expiredConnection, setExpiredConnection] = useState<ConnectionExpiredEvent | null>(null)

  // Subscribe to connection expired events
  useEffect(() => {
    const unsubscribe = connectionExpiredEmitter.subscribe((event) => {
      setExpiredConnection(event)
    })

    return unsubscribe
  }, [])

  return (
    <InternalAppsContextProvider>
      <AppsContextProvider
        appInstallations={installations}
        appConnections={connections}
        mcpServers={mcpServers}
        isLoading={isLoading}
        isError={!!error}
        refreshInstallations={refreshInstallations}
        refreshMcpServers={refreshMcpServers}>
        {/* Set up infrastructure for each extension - only when loaded */}
        {!isLoading &&
          !error &&
          organizationId &&
          installations
            .filter((i) => i.currentDeployment?.clientBundleSha)
            .map((installation) => {
              const isDevLoggingEnabled = true //installation.installationType === 'development'

              return (
                <Fragment key={installation.installationId}>
                  {/* Error boundary isolates failures - one bad extension won't crash others */}
                  <ErrorBoundary
                    fallback={null} // Silent failure - extension just won't load
                    onError={(error) => {
                      // Show toast in dev mode for better debugging experience
                      if (isDevLoggingEnabled) {
                        toastError({
                          title: `Extension error: ${installation.app.title}`,
                          description: error.message,
                        })
                      }
                    }}>
                    {/* 1. Create MessageClient for this extension (Plan 3) */}
                    <MessageClientWrapper
                      appId={installation.app.id}
                      appSlug={installation.app.slug}
                      appInstallationId={installation.installationId}
                      appTitle={installation.app.title}
                      organizationId={organizationId}
                      clientBundleSha={installation.currentDeployment!.clientBundleSha}
                      connectionDefinition={
                        installation.connectionDefinitions?.user ??
                        installation.connectionDefinitions?.organization
                      }
                    />

                    {/* 2. Set up data handlers for this extension (Plan 4) */}
                    <Suspense>
                      <AppDataHandlerContextProvider
                        appId={installation.app.id}
                        appInstallationId={installation.installationId}
                        isDevLoggingEnabled={isDevLoggingEnabled}>
                        {/* Listen for surface registration */}
                        <SurfacesDataHandler />

                        {/* Listen for asset registration */}
                        <AssetsDataHandler />

                        {/* Listen for render updates */}
                        <RenderDataHandler />

                        {/* Listen for trigger completion */}
                        <TriggerDataHandler />

                        {/* Listen for dialog render/unrender */}
                        <DialogDataHandler />

                        {/* Serve record reads for the app `useRecord` hook */}
                        <RecordDataHandler />
                      </AppDataHandlerContextProvider>
                    </Suspense>
                  </ErrorBoundary>
                </Fragment>
              )
            })}

        {/* Main app content */}
        {children}

        {/* Connection expired dialog */}
        {expiredConnection && (
          <ConnectionExpiredDialog
            open={!!expiredConnection}
            onOpenChange={(open) => {
              if (!open) setExpiredConnection(null)
            }}
            appId={expiredConnection.appId}
            appSlug={expiredConnection.appSlug}
            appName={expiredConnection.appName}
            installationId={expiredConnection.installationId}
            scope={expiredConnection.scope}
            connectionType={expiredConnection.connectionType}
            connectionLabel={expiredConnection.connectionLabel}
            reason={expiredConnection.reason}
            returnTo={pathname}
            onReconnected={() => {
              // Close dialog - user can manually retry the operation
              setExpiredConnection(null)
            }}
          />
        )}
      </AppsContextProvider>
    </InternalAppsContextProvider>
  )
}
