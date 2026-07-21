// apps/web/src/components/apps/ui/app-connections.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import type { LucideIcon } from 'lucide-react'
import { MoreHorizontal, Pencil, Plus, RefreshCw, Star, Unplug, User, Users } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { useEffect } from 'react'
import { SettingsSection } from '~/components/global/settings-page'
import { useUser } from '~/hooks/use-user'
import type { RouterOutputs } from '~/trpc/react'
import { api } from '~/trpc/react'
import { type ConnectTarget, useConnectFlow } from '../hooks/use-connect-flow'
import { useConnectionRowActions } from '../hooks/use-connection-row-actions'
import { ConnectionList } from './connection-list'
import { ConnectionRow } from './connection-row'

type AppData = RouterOutputs['apps']['getBySlug']
type ConnectionRowType = RouterOutputs['apps']['listConnections'][number]
type ConnectionDefinition = NonNullable<AppData['installation']['connectionDefinitions']['user']>
type ConnectionMethod = NonNullable<AppData['installation']['methods']>[number]
type Scope = 'user' | 'organization'

type Props = {
  app: AppData
  returnTo?: string
  /** If set, render only the matching section. Otherwise render both (gated on definitions). */
  scope?: Scope
  /** Fired when a connect attempt produces a new credId (for parent dialogs that want to react). */
  onConnectionCreated?: (credId: string, scope: Scope) => void
}

function AppConnections({ app, returnTo, scope, onConnectionCreated }: Props) {
  const searchParams = useSearchParams()
  const success = searchParams.get('success') || searchParams.get('oauth_success')
  const { userId, isAdminOrOwner } = useUser()

  const {
    data: connectionsResult,
    refetch: refetchConnections,
    isLoading: isLoadingConnections,
  } = api.apps.listConnections.useQuery()

  useEffect(() => {
    if (success === 'true') {
      void refetchConnections()
    }
  }, [success, refetchConnections])

  if (!app.installation.isInstalled) {
    return (
      <div className='flex-1 flex-col space-y-6 px-6 py-6'>
        <div className='border bg-primary-50 w-full p-6 rounded-2xl text-center'>
          <div className='text-base font-medium mb-2'>App not installed</div>
          <div className='text-sm text-muted-foreground'>This app needs to be installed first</div>
        </div>
      </div>
    )
  }

  const { user: userDef, organization: orgDef } = app.installation.connectionDefinitions ?? {}
  const showPersonal = !!userDef && (scope === undefined || scope === 'user')
  const showWorkspace = !!orgDef && (scope === undefined || scope === 'organization')

  if (!showPersonal && !showWorkspace) {
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

  const allConnections = connectionsResult ?? []
  const installationId = app.installation.id!
  const methods = app.installation.methods ?? []
  const target: ConnectTarget = {
    owner: { kind: 'app', appId: app.app.id, appSlug: app.app.slug, installationId },
    title: app.app.title,
    connectionDefinitions: app.installation.connectionDefinitions ?? {},
    methods: methods.map((m) => ({
      id: m.id,
      connectionType: m.connectionType,
      description: m.description ?? undefined,
      connectionVariables: m.connectionVariables,
      requiresOwnClient: m.requiresOwnClient,
      ownClientOptional: m.ownClientOptional,
      ownClientReason: m.ownClientReason,
    })),
  }
  const personalMethods = methods.filter((m) => !m.global)
  const workspaceMethods = methods.filter((m) => m.global)

  const personalRows = allConnections.filter(
    (conn) =>
      conn.appId === app.app.id &&
      conn.appInstallationId === installationId &&
      conn.global === false &&
      conn.userId === userId
  )
  const workspaceRows = allConnections.filter(
    (conn) =>
      conn.appId === app.app.id && conn.appInstallationId === installationId && conn.global === true
  )

  return (
    <div className='flex-1 flex-col space-y-6 px-6 py-6'>
      {showPersonal && userDef && (
        <ConnectionSection
          target={target}
          definition={userDef}
          methods={personalMethods}
          scope='user'
          rows={personalRows}
          returnTo={returnTo}
          canEdit
          icon={User}
          title='Personal'
          isLoading={isLoadingConnections}
          onConnectionCreated={onConnectionCreated}
        />
      )}
      {showWorkspace && orgDef && (
        <ConnectionSection
          target={target}
          definition={orgDef}
          methods={workspaceMethods}
          scope='organization'
          rows={workspaceRows}
          returnTo={returnTo}
          canEdit={isAdminOrOwner}
          icon={Users}
          title='Workspace'
          isLoading={isLoadingConnections}
          onConnectionCreated={onConnectionCreated}
        />
      )}
    </div>
  )
}

export default AppConnections

type ConnectionSectionProps = {
  target: ConnectTarget
  definition: ConnectionDefinition
  /** Every method available in this scope. >1 makes the Add button a method picker. */
  methods: ConnectionMethod[]
  scope: Scope
  rows: ConnectionRowType[]
  returnTo?: string
  canEdit: boolean
  icon: LucideIcon
  title: string
  isLoading: boolean
  onConnectionCreated?: (credId: string, scope: Scope) => void
}

function ConnectionSection({
  target,
  definition,
  methods,
  scope,
  rows,
  returnTo,
  canEdit,
  icon,
  title,
  isLoading,
  onConnectionCreated,
}: ConnectionSectionProps) {
  const isOAuth = definition.connectionType === 'oauth2-code'
  const isSecret = definition.connectionType === 'secret'
  // `hosted-provision` is platform-provider-only (see hosted-provision-connection-type.md
  // non-goals) — an app-owned definition never carries this type today. Derived alongside the
  // others for parity so this gate doesn't silently exclude it if that ever changes; `flow.start`
  // already dispatches hosted-provision to a full-page navigate with no dialog.
  const isHostedProvision = definition.connectionType === 'hosted-provision'

  const flow = useConnectFlow({
    onConnected: onConnectionCreated
      ? (credId, args) => onConnectionCreated(credId, args.scope)
      : undefined,
  })
  const rowActions = useConnectionRowActions()

  const utils = api.useUtils()
  const setDefault = api.apps.setDefaultConnection.useMutation({
    onSuccess: () => void utils.apps.listConnections.invalidate(),
  })

  const showAddButton = canEdit && (isOAuth || isSecret || isHostedProvision)
  // The primary pointer only matters when an org has >1 connection in the workspace scope (§4a).
  const showPrimary = scope === 'organization' && rows.length > 1

  // Connect via a specific method — explicit when the app exposes more than one.
  const connectMethod = (definitionId?: string) =>
    flow.start({ target, scope, returnTo, definitionId })

  return (
    <SettingsSection
      className='space-y-2'
      icon={icon}
      title={title}
      action={
        showAddButton ? (
          methods.length > 1 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant='outline' size='sm'>
                  <Plus />
                  Add Connection
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end'>
                {methods.map((m) => (
                  <DropdownMenuItem key={m.id} onClick={() => connectMethod(m.id)}>
                    {m.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button variant='outline' size='sm' onClick={() => connectMethod(methods[0]?.id)}>
              <Plus />
              Add Connection
            </Button>
          )
        ) : undefined
      }>
      <ConnectionList
        isLoading={isLoading}
        emptyMessage={
          <>
            No connections yet.
            {canEdit ? ' Add a connection to get started.' : ' Ask an admin to connect.'}
          </>
        }>
        {rows.map((conn) => (
          <ConnectionRow
            key={conn.id}
            status={
              conn.connectionStatus === 'connected'
                ? 'connected'
                : conn.connectionStatus === 'expired'
                  ? 'expired'
                  : 'disconnected'
            }
            title={conn.label || conn.appName}
            subtitle={`${
              conn.connectionStatus === 'connected'
                ? 'Connected'
                : conn.connectionStatus === 'expired'
                  ? 'Token expired'
                  : 'Not connected'
            }${conn.connectedBy ? ` by ${conn.connectedBy}` : ''}${
              showPrimary && conn.isDefault ? ' · Primary' : ''
            }`}
            renameValue={conn.label || ''}
            onRename={(label) => rowActions.rename(conn.id, label)}
            actions={
              canEdit
                ? ({ beginRename }) => (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant='ghost' size='icon-sm'>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align='end'>
                        <DropdownMenuItem onClick={beginRename}>
                          <Pencil />
                          Rename
                        </DropdownMenuItem>
                        {(conn.connectionStatus === 'expired' ||
                          conn.connectionStatus === 'connected') &&
                          (isOAuth || isSecret || isHostedProvision) && (
                            <DropdownMenuItem
                              onClick={() =>
                                flow.start({
                                  target,
                                  scope,
                                  returnTo,
                                  connectionId: conn.id,
                                  // Reconnect the same method this connection was made with.
                                  definitionId: conn.connectionDefinitionId ?? undefined,
                                  // Secret reconnect prefills plain variables; secrets are re-entered.
                                  prefillVariables: conn.connectionVariables ?? undefined,
                                })
                              }>
                              <RefreshCw />
                              Reconnect
                            </DropdownMenuItem>
                          )}
                        {showPrimary &&
                          !conn.isDefault &&
                          conn.connectionStatus === 'connected' && (
                            <DropdownMenuItem
                              onClick={() => setDefault.mutate({ connectionId: conn.id })}>
                              <Star />
                              Set as primary
                            </DropdownMenuItem>
                          )}
                        <DropdownMenuItem
                          variant='destructive'
                          onClick={() => rowActions.disconnect(conn.id, conn.label)}>
                          <Unplug />
                          Disconnect
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )
                : undefined
            }
          />
        ))}
      </ConnectionList>
      {flow.Dialogs}
      <rowActions.ConfirmDialog />
    </SettingsSection>
  )
}
