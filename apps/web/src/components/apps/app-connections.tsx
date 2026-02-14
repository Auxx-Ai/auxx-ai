// apps/web/src/components/apps/app-connections.tsx

'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { toastSuccess } from '@auxx/ui/components/toast'
import { useSearchParams } from 'next/navigation'
import { useEffect } from 'react'
import type { RouterOutputs } from '~/trpc/react'
import { api } from '~/trpc/react'
import { AppConnectionStatus } from './app-connection-status'

/**
 * Props for AppConnections component
 */
type Props = {
  app: RouterOutputs['apps']['getBySlug']
}

/**
 * AppConnections component
 * Displays and manages app connections for an installed application
 */
function AppConnections({ app }: Props) {
  const searchParams = useSearchParams()
  const success = searchParams.get('success')

  // Fetch installed apps to get connection definition
  const { data: installedResult } = api.apps.listInstalled.useQuery({})
  const { data: connectionsResult, refetch: refetchConnections } =
    api.apps.listConnections.useQuery()

  // Show success toast and refetch when returning from OAuth
  useEffect(() => {
    if (success === 'true') {
      toastSuccess({
        title: 'Connection Successful',
        description: 'Your app has been connected successfully!',
      })
      // Refetch connections to get the latest data
      void refetchConnections()
    }
  }, [success, refetchConnections])

  const installations = installedResult?.installations ?? []
  const connections = connectionsResult ?? []

  // Find the installation for this app
  const installation = installations.find((inst) => inst.app.id === app.app.id)

  console.log(installation)

  // Check if this app has a connection definition
  const connectionDefinition = installation?.connectionDefinition

  if (!installation) {
    return (
      <div className='flex-1 flex-col space-y-6 px-6 py-6'>
        <div className='border bg-primary-50 w-full p-6 rounded-2xl text-center'>
          <div className='text-base font-medium mb-2'>App not installed</div>
          <div className='text-sm text-muted-foreground'>This app needs to be installed first</div>
        </div>
      </div>
    )
  }

  if (!connectionDefinition) {
    return (
      <div className='flex-1 flex-col space-y-6 px-6 py-6'>
        <div className='border bg-primary-50 w-full p-6 rounded-2xl text-center'>
          <div className='text-base font-medium mb-2'>No connection required</div>
          <div className='text-sm text-muted-foreground'>
            {app.app.title} does not require any external connections
          </div>
        </div>
      </div>
    )
  }

  // Find active connection for this app
  const activeConnection = connections.find((conn) => conn.appId === app.app.id)

  const connectionStatus: 'connected' | 'not_connected' | 'expired' = activeConnection
    ? activeConnection.connectionStatus
    : 'not_connected'

  const connectionType = connectionDefinition.global ? 'organization' : 'user'

  return (
    <div className='flex-1 flex-col space-y-6 px-6 py-6'>
      <Card>
        <CardHeader>
          <CardTitle>App Connection</CardTitle>
          <CardDescription>
            Manage the connection for {app.app.title}. This {connectionType} connection is{' '}
            {connectionDefinition.global
              ? 'shared across your organization'
              : 'specific to your user account'}
            .
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className='space-y-4'>
            <div>
              <div className='text-sm font-medium mb-2'>Connection Type</div>
              <div className='text-sm text-muted-foreground capitalize'>
                {connectionDefinition.connectionType === 'oauth2-code'
                  ? 'OAuth 2.0'
                  : connectionDefinition.connectionType}
              </div>
            </div>

            <div>
              <div className='text-sm font-medium mb-2'>Status</div>
              <AppConnectionStatus
                appId={app.app.id}
                appSlug={app.app.slug}
                installationId={installation.installationId}
                connectionStatus={connectionStatus}
                connectionLabel={connectionDefinition.label}
                connectionType={connectionType}
                credentialId={activeConnection?.id}
                connectionDefinition={connectionDefinition}
                onConnectionSaved={refetchConnections}
              />
            </div>

            {activeConnection && (
              <>
                {activeConnection.connectedBy && (
                  <div>
                    <div className='text-sm font-medium mb-2'>Connected By</div>
                    <div className='text-sm text-muted-foreground'>
                      {activeConnection.connectedBy}
                    </div>
                  </div>
                )}

                {activeConnection.connectedAt && (
                  <div>
                    <div className='text-sm font-medium mb-2'>Connected At</div>
                    <div className='text-sm text-muted-foreground'>
                      {new Date(activeConnection.connectedAt).toLocaleString()}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default AppConnections
