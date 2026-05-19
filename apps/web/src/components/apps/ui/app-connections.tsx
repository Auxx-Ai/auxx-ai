// apps/web/src/components/apps/ui/app-connections.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { MoreHorizontal, Pencil, Plus, Unplug, User, Users } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { useEffect } from 'react'
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
  const target: ConnectTarget = {
    appId: app.app.id,
    appSlug: app.app.slug,
    appTitle: app.app.title,
    installationId,
    connectionDefinitions: app.installation.connectionDefinitions ?? {},
  }

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
          scope='user'
          rows={personalRows}
          returnTo={returnTo}
          canEdit
          icon={<User className='size-4' />}
          title='Personal'
          isLoading={isLoadingConnections}
          onConnectionCreated={onConnectionCreated}
        />
      )}
      {showWorkspace && orgDef && (
        <ConnectionSection
          target={target}
          definition={orgDef}
          scope='organization'
          rows={workspaceRows}
          returnTo={returnTo}
          canEdit={isAdminOrOwner}
          icon={<Users className='size-4' />}
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
  scope: Scope
  rows: ConnectionRowType[]
  returnTo?: string
  canEdit: boolean
  icon: React.ReactNode
  title: string
  isLoading: boolean
  onConnectionCreated?: (credId: string, scope: Scope) => void
}

function ConnectionSection({
  target,
  definition,
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

  const flow = useConnectFlow({
    onConnected: onConnectionCreated
      ? (credId, args) => onConnectionCreated(credId, args.scope)
      : undefined,
  })
  const rowActions = useConnectionRowActions()

  const showAddButton = canEdit && (isOAuth || isSecret)

  return (
    <div className='space-y-2'>
      <div className='flex items-end justify-between'>
        <div className='flex items-center gap-2 tracking-tight font-semibold text-foreground text-base'>
          {icon}
          {title}
        </div>
        {showAddButton && (
          <Button
            variant='outline'
            size='sm'
            onClick={() => flow.start({ target, scope, returnTo })}>
            <Plus />
            Add Connection
          </Button>
        )}
      </div>
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
            connection={conn}
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
                          isOAuth && (
                            <DropdownMenuItem
                              onClick={() =>
                                flow.start({ target, scope, returnTo, connectionId: conn.id })
                              }>
                              Reconnect
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
    </div>
  )
}
