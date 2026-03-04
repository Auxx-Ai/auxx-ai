// apps/web/src/components/apps/app-settings-dialog.tsx

'use client'

import type { SettingsSchemaField } from '@auxx/services/app-settings/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@auxx/ui/components/dialog'
import { Item, ItemContent, ItemGroup, ItemHeader } from '@auxx/ui/components/item'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { toastError } from '@auxx/ui/components/toast'
import { Code, Globe, LucideGitGraph, Mail } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { useExtensionsContext } from '~/providers/extensions/extensions-context'
import { api } from '~/trpc/react'
import { AppConnectionStatus } from './app-connection-status'
import { SettingsFormRenderer } from './settings-form-renderer'

interface AppSettingsDialogProps {
  appSlug: string
  /** Required for settings tab queries (getSettingsSchema, getSettings) */
  installationType: 'development' | 'production'
  /** Optional return URL for OAuth redirects (e.g., current workflow URL) */
  returnTo?: string
  /** Caller provides the trigger button */
  trigger: ReactNode
}

/**
 * Reusable dialog for managing app settings inline — usable from workflow panel,
 * ticket view, or anywhere an app needs inline management.
 */
export function AppSettingsDialog({
  appSlug,
  installationType,
  returnTo,
  trigger,
}: AppSettingsDialogProps) {
  const [open, setOpen] = useState(false)
  const [activeTab, setActiveTab] = useState('about')

  const { appInstallations } = useExtensionsContext()

  // Find installation by slug + installationType
  const installation = useMemo(
    () =>
      appInstallations.find(
        (i) => i.app.slug === appSlug && i.installationType === installationType
      ),
    [appInstallations, appSlug, installationType]
  )

  if (!installation) return null

  const hasConnectionDefinition = !!installation.connectionDefinition

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent size='lg' position='tc' innerClassName='p-0'>
        <DialogHeader className='my-2'>
          <DialogTitle className='flex items-center gap-2 px-2 '>
            {installation.app.avatarUrl && (
              <img
                src={installation.app.avatarUrl}
                alt={installation.app.title}
                className='size-6 rounded'
              />
            )}
            {installation.app.title}
          </DialogTitle>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className='flex-1 flex flex-col min-h-0'>
          <TabsList variant='outline'>
            <TabsTrigger value='about' variant='outline' size='sm'>
              About
            </TabsTrigger>
            {hasConnectionDefinition && (
              <TabsTrigger value='connections' variant='outline' size='sm'>
                Connections
              </TabsTrigger>
            )}
            <TabsTrigger value='settings' variant='outline' size='sm'>
              Settings
            </TabsTrigger>
          </TabsList>

          <div className='flex-1 overflow-y-auto'>
            <TabsContent value='about' className='mt-0'>
              <AboutTab appSlug={appSlug} />
            </TabsContent>

            {hasConnectionDefinition && (
              <TabsContent value='connections' className='mt-0'>
                <ConnectionsTab installation={installation} returnTo={returnTo} />
              </TabsContent>
            )}

            <TabsContent value='settings' className='mt-0'>
              <SettingsTab
                appSlug={appSlug}
                installationType={installationType}
                active={activeTab === 'settings'}
              />
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

/**
 * About tab — fetches full app details via apps.getBySlug
 */
function AboutTab({ appSlug }: { appSlug: string }) {
  const { data: app, isLoading } = api.apps.getBySlug.useQuery({ appSlug })

  if (isLoading) {
    return <div className='p-6 text-sm text-muted-foreground'>Loading app details...</div>
  }

  if (!app) {
    return <div className='p-6 text-sm text-muted-foreground'>App not found.</div>
  }

  const latestDeployment = app.availableDeployments[0]
  const installedDeployment = app.installation.isInstalled
    ? app.availableDeployments.find((d) => d.id === app.installation.currentDeploymentId)
    : null

  return (
    <div className='p-6 space-y-4'>
      {app.app.description && (
        <p className='text-sm text-muted-foreground'>{app.app.description}</p>
      )}

      <ItemGroup className='gap-3'>
        {app.app.category && (
          <Item className='p-0 gap-1'>
            <ItemHeader className='text-xs text-primary-400'>Category</ItemHeader>
            <ItemContent className='flex items-center flex-row'>
              <LucideGitGraph className='size-3' />
              {app.app.category}
            </ItemContent>
          </Item>
        )}
        <Item className='p-0 gap-1'>
          <ItemHeader className='text-xs text-primary-400'>Built by</ItemHeader>
          <ItemContent className='flex items-center flex-row'>
            <Mail className='size-3' />
            {app.developerAccount.title}
          </ItemContent>
        </Item>
        {latestDeployment && (
          <Item className='p-0 gap-1'>
            <ItemHeader className='text-xs text-primary-400'>Latest version</ItemHeader>
            <ItemContent className='flex-row items-center'>
              {latestDeployment.version || 'Development'}
              {latestDeployment.deploymentType === 'development' && (
                <Badge variant='secondary' className='text-xs'>
                  <Code className='size-3' />
                  Dev
                </Badge>
              )}
            </ItemContent>
          </Item>
        )}
        {installedDeployment && (
          <Item className='p-0 gap-1'>
            <ItemHeader className='text-xs text-primary-400'>Installed version</ItemHeader>
            <ItemContent className='flex flex-row items-center'>
              {installedDeployment.version || 'Development'}
              {installedDeployment.deploymentType === 'development' && (
                <Badge variant='secondary' className='text-xs'>
                  <Code className='size-3' />
                  Dev
                </Badge>
              )}
            </ItemContent>
          </Item>
        )}
      </ItemGroup>

      {(app.app.websiteUrl || app.app.documentationUrl || app.app.supportSiteUrl) && (
        <div className='space-y-1'>
          <div className='text-xs text-primary-400'>Resources</div>
          <div className='flex flex-col items-start'>
            {app.app.websiteUrl && (
              <Button variant='link' size='sm' className='pl-0' asChild>
                <a href={app.app.websiteUrl} target='_blank' rel='noopener noreferrer'>
                  <Globe /> Website
                </a>
              </Button>
            )}
            {app.app.documentationUrl && (
              <Button variant='link' size='sm' className='pl-0' asChild>
                <a href={app.app.documentationUrl} target='_blank' rel='noopener noreferrer'>
                  <Globe /> Documentation
                </a>
              </Button>
            )}
            {app.app.supportSiteUrl && (
              <Button variant='link' size='sm' className='pl-0' asChild>
                <a href={app.app.supportSiteUrl} target='_blank' rel='noopener noreferrer'>
                  <Globe /> Contact
                </a>
              </Button>
            )}
          </div>
        </div>
      )}

      {app.app.contentOverview && (
        <section className='space-y-2'>
          <h3 className='text-sm font-semibold'>Overview</h3>
          <div className='text-sm prose prose-sm max-w-none'>{app.app.contentOverview}</div>
        </section>
      )}
    </div>
  )
}

/**
 * Connections tab — shows connection status using existing AppConnectionStatus
 */
function ConnectionsTab({ installation, returnTo }: { installation: any; returnTo?: string }) {
  const { data: connectionsResult, refetch: refetchConnections } =
    api.apps.listConnections.useQuery()

  const connections = connectionsResult ?? []
  const connectionDefinition = installation.connectionDefinition

  // Find active connection for this app
  const activeConnection = connections.find((conn: any) => conn.appId === installation.app.id)

  const connectionStatus: 'connected' | 'not_connected' | 'expired' = activeConnection
    ? activeConnection.connectionStatus
    : 'not_connected'

  const connectionType = connectionDefinition.global ? 'organization' : 'user'

  return (
    <div className='p-6'>
      <Card>
        <CardHeader>
          <CardTitle className='text-base'>App Connection</CardTitle>
          <CardDescription>
            This {connectionType} connection is{' '}
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
                appId={installation.app.id}
                appSlug={installation.app.slug}
                installationId={installation.installationId}
                connectionStatus={connectionStatus}
                connectionLabel={connectionDefinition.label}
                connectionType={connectionType}
                credentialId={activeConnection?.id}
                connectionDefinition={connectionDefinition}
                onConnectionSaved={refetchConnections}
                returnTo={returnTo}
              />
            </div>
            {activeConnection?.connectedBy && (
              <div>
                <div className='text-sm font-medium mb-2'>Connected By</div>
                <div className='text-sm text-muted-foreground'>{activeConnection.connectedBy}</div>
              </div>
            )}
            {activeConnection?.connectedAt && (
              <div>
                <div className='text-sm font-medium mb-2'>Connected At</div>
                <div className='text-sm text-muted-foreground'>
                  {new Date(activeConnection.connectedAt).toLocaleString()}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

/**
 * Settings tab — lazy-loads schema and values when activated
 */
function SettingsTab({
  appSlug,
  installationType,
  active,
}: {
  appSlug: string
  installationType: 'development' | 'production'
  active: boolean
}) {
  const { data: schema, isLoading: schemaLoading } = api.apps.getSettingsSchema.useQuery(
    { appSlug, installationType },
    { enabled: active }
  )

  const { data: currentSettings, isLoading: settingsLoading } = api.apps.getSettings.useQuery(
    { appSlug, installationType },
    { enabled: active }
  )

  const saveSettings = api.apps.saveSettings.useMutation({
    onError: (error) => {
      toastError({
        title: 'Failed to save settings',
        description: error.message,
      })
    },
  })

  const handleSubmit = async (values: Record<string, any>) => {
    await saveSettings.mutateAsync({
      appSlug,
      installationType,
      settings: values,
    })
  }

  if (!active) return null

  if (schemaLoading || settingsLoading) {
    return <div className='p-6 text-sm text-muted-foreground'>Loading settings...</div>
  }

  const schemaFields = (schema as Record<string, SettingsSchemaField>) ?? {}
  const settings = (currentSettings as Record<string, any>) ?? {}

  if (Object.keys(schemaFields).length === 0) {
    return (
      <div className='p-6 text-center text-sm text-muted-foreground'>
        No settings available for this app.
      </div>
    )
  }

  return (
    <SettingsFormRenderer
      schema={schemaFields}
      defaultValues={settings}
      onSubmit={handleSubmit}
      isPending={saveSettings.isPending}
    />
  )
}
