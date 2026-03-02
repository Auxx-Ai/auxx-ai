// apps/web/src/providers/extensions/extensions-provider.tsx
'use client'

import { toastError } from '@auxx/ui/components/toast'
import { Fragment, type ReactNode, Suspense, useEffect, useState } from 'react'
import { ConnectionExpiredDialog } from '~/components/apps/connection-expired-dialog'
import { AssetsDataHandler } from '~/components/extensions/data-handlers/assets-data-handler'
import { DialogDataHandler } from '~/components/extensions/data-handlers/dialog-data-handler'
import { RenderDataHandler } from '~/components/extensions/data-handlers/render-data-handler'
import { SurfacesDataHandler } from '~/components/extensions/data-handlers/surfaces-data-handler'
import { TriggerDataHandler } from '~/components/extensions/data-handlers/trigger-data-handler'
import { ErrorBoundary } from '~/components/extensions/error-boundary'
import { MessageClientWrapper } from '~/components/extensions/message-client-wrapper'
import {
  type ConnectionExpiredEvent,
  connectionExpiredEmitter,
} from '~/lib/extensions/connection-expired-emitter'
import { useDehydratedOrganizationId } from '~/providers/dehydrated-state-provider'
import { api } from '~/trpc/react'
import { ExtensionDataHandlerContextProvider } from './extension-data-handler-context'
import { ExtensionsContextProvider } from './extensions-context'
import { InternalAppsContextProvider } from './internal-apps-context'

/**
 * Props for ExtensionsProvider
 */
interface ExtensionsProviderProps {
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
 * 5. Provides list of installed extensions to children via ExtensionsContextProvider
 * 6. Renders children with extension infrastructure available
 *
 * Note: This component must be rendered in a client component tree since it uses React Query.
 */
export function ExtensionsProvider({ children }: ExtensionsProviderProps) {
  const organizationId = useDehydratedOrganizationId()

  // Fetch installed apps for this organization
  // Note: organizationId is retrieved from session in the tRPC procedure
  const {
    data: result,
    isLoading,
    error,
  } = api.apps.listInstalled.useQuery({
    // type filter is optional - omitting it returns all installations (both dev and production)
  })

  // Always provide installations (empty during loading)
  const installations = result?.installations || []

  // Show error toast if loading failed
  if (error) {
    console.error('[Extensions] Failed to load extensions:', error)
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
      console.log('[Extensions] Connection expired event received:', event)
      setExpiredConnection(event)
    })

    return unsubscribe
  }, [])

  console.log(
    `[Extensions] ${isLoading ? 'Loading' : 'Loaded'} ${installations.length} installed extensions`,
    {
      apps: installations.map((i) => ({
        slug: i.app.slug,
        type: i.installationType,
        version: i.currentDeployment?.version,
        clientBundleSha: i.currentDeployment?.clientBundleSha ?? null,
        hasDeployment: !!i.currentDeployment,
      })),
    }
  )

  return (
    <InternalAppsContextProvider>
      <ExtensionsContextProvider
        appInstallations={installations}
        isLoading={isLoading}
        isError={!!error}>
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
                      console.error(`[Extensions] ${installation.app.title} failed:`, error)

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
                      connectionDefinition={installation.connectionDefinition}
                    />

                    {/* 2. Set up data handlers for this extension (Plan 4) */}
                    <Suspense>
                      <ExtensionDataHandlerContextProvider
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
                      </ExtensionDataHandlerContextProvider>
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
            onReconnected={() => {
              // Close dialog - user can manually retry the operation
              setExpiredConnection(null)
            }}
          />
        )}
      </ExtensionsContextProvider>
    </InternalAppsContextProvider>
  )
}
