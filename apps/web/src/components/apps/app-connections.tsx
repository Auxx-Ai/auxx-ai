// apps/web/src/components/apps/app-connections.tsx

'use client'

import type { ConnectionVariable, OAuth2Features } from '@auxx/database'
import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Field, FieldDescription, FieldLabel } from '@auxx/ui/components/field'
import { Input } from '@auxx/ui/components/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@auxx/ui/components/input-group'
import { toastError } from '@auxx/ui/components/toast'
import {
  Check,
  CheckCircle,
  Clock,
  MoreHorizontal,
  Pencil,
  Plus,
  Unplug,
  X,
  XCircle,
} from 'lucide-react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { SecretConnectionDialogContent } from '~/components/apps/app-connection-status'
import { useConfirm } from '~/hooks/use-confirm'
import type { RouterOutputs } from '~/trpc/react'
import { api } from '~/trpc/react'

type Props = {
  app: RouterOutputs['apps']['getBySlug']
}

function AppConnections({ app }: Props) {
  const searchParams = useSearchParams()
  const success = searchParams.get('success') || searchParams.get('oauth_success')
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [secretDialogOpen, setSecretDialogOpen] = useState(false)
  const [secret, setSecret] = useState('')
  const [showSecret, setShowSecret] = useState(false)
  const [variableDialogOpen, setVariableDialogOpen] = useState(false)
  const [variableValues, setVariableValues] = useState<Record<string, string>>({})
  const [reconnectConnectionId, setReconnectConnectionId] = useState<string | null>(null)

  const { data: installedResult } = api.apps.listInstalled.useQuery({})
  const { data: connectionsResult, refetch: refetchConnections } =
    api.apps.listConnections.useQuery()

  useEffect(() => {
    if (success === 'true') {
      void refetchConnections()
    }
  }, [success, refetchConnections])

  const installations = installedResult?.installations ?? []
  const allConnections = connectionsResult ?? []
  const installation = installations.find((inst) => inst.app.id === app.app.id)
  const connectionDefinition = installation?.connectionDefinition

  const deleteConnection = api.apps.deleteConnection.useMutation({
    onSuccess: () => {
      void utils.apps.listConnections.invalidate()
      void utils.apps.listInstalled.invalidate()
    },
    onError: (error) => {
      toastError({ title: 'Failed to disconnect', description: error.message })
    },
  })

  const saveSecret = api.apps.saveSecretConnection.useMutation({
    onSuccess: () => {
      setSecretDialogOpen(false)
      setSecret('')
      void utils.apps.listConnections.invalidate()
      void utils.apps.listInstalled.invalidate()
    },
    onError: (error) => {
      toastError({ title: 'Failed to save connection', description: error.message })
    },
  })

  const renameConnection = api.apps.renameConnection.useMutation({
    onSuccess: () => {
      setEditingId(null)
      void utils.apps.listConnections.invalidate()
    },
    onError: (error) => {
      toastError({ title: 'Failed to rename', description: error.message })
    },
  })

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

  // Filter connections for this app + installation (org-scoped only)
  const appConnections = allConnections.filter(
    (conn) =>
      conn.appId === app.app.id &&
      conn.appInstallationId === installation.installationId &&
      conn.global
  )

  const connectionType = connectionDefinition.global ? 'organization' : 'user'
  const isOAuth = connectionDefinition.connectionType === 'oauth2-code'
  const connectionVarDefs: ConnectionVariable[] =
    (connectionDefinition.oauth2Features as OAuth2Features | null)?.connectionVariables ?? []

  const handleAddConnection = () => {
    if (connectionVarDefs.length > 0) {
      setReconnectConnectionId(null)
      setVariableValues({})
      setVariableDialogOpen(true)
    } else if (addConnectionUrl) {
      window.location.href = addConnectionUrl
    }
  }

  const handleReconnect = (connectionId: string) => {
    if (connectionVarDefs.length > 0) {
      setReconnectConnectionId(connectionId)
      setVariableValues({})
      setVariableDialogOpen(true)
    } else {
      window.location.href = `/api/apps/${app.app.slug}/oauth2/authorize?installation=${installation.installationId}&type=${connectionType}&connectionId=${connectionId}`
    }
  }

  const handleVariableSubmit = () => {
    // Validate required variables
    for (const varDef of connectionVarDefs) {
      if (varDef.required !== false && !variableValues[varDef.key]?.trim()) {
        toastError({
          title: 'Missing required field',
          description: `Please provide a value for "${varDef.label}".`,
        })
        return
      }
    }

    const params = new URLSearchParams()
    params.set('installation', installation.installationId)
    params.set('type', connectionType)
    if (reconnectConnectionId) {
      params.set('connectionId', reconnectConnectionId)
    }
    for (const [key, value] of Object.entries(variableValues)) {
      if (value) params.set(`var_${key}`, value)
    }
    window.location.href = `/api/apps/${app.app.slug}/oauth2/authorize?${params}`
  }

  const handleDisconnect = async (credentialId: string, label: string | null) => {
    const confirmed = await confirm({
      title: 'Disconnect?',
      description: `Are you sure you want to disconnect "${label || 'Connection'}"? This may affect workflows using this connection.`,
      confirmText: 'Disconnect',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      deleteConnection.mutate({ credentialId })
    }
  }

  const handleRename = (connectionId: string) => {
    const trimmed = editLabel.trim()
    if (!trimmed) return
    renameConnection.mutate({ connectionId, label: trimmed })
  }

  const handleSaveSecret = () => {
    if (!secret.trim()) {
      toastError({ title: 'Validation Error', description: 'Please enter an API key.' })
      return
    }
    saveSecret.mutate({
      appId: app.app.id,
      installationId: installation.installationId,
      appName: app.app.title,
      connectionType,
      secret: secret.trim(),
    })
  }

  const handleStartEdit = (connectionId: string, currentLabel: string | null) => {
    setEditingId(connectionId)
    setEditLabel(currentLabel || '')
  }

  // Build "Add Connection" URL (new flow — no connectionId)
  const addConnectionUrl = isOAuth
    ? `/api/apps/${app.app.slug}/oauth2/authorize?installation=${installation.installationId}&type=${connectionType}`
    : null

  const StatusIcon = ({ status }: { status: string }) => {
    if (status === 'connected') return <CheckCircle className='h-4 w-4 text-green-500' />
    if (status === 'expired') return <Clock className='h-4 w-4 text-yellow-500' />
    return <XCircle className='h-4 w-4 text-gray-400' />
  }

  return (
    <div className='flex-1 flex-col space-y-6 px-6 py-6'>
      <Card>
        <CardHeader className='flex-row items-center justify-between'>
          <div>
            <CardTitle>Connections</CardTitle>
            <CardDescription>
              Manage connections for {app.app.title}. Each connection can be used by different
              workflows.
            </CardDescription>
          </div>
          {addConnectionUrl ? (
            <Button variant='outline' size='sm' onClick={handleAddConnection}>
              <Plus />
              Add Connection
            </Button>
          ) : (
            connectionDefinition.connectionType === 'secret' && (
              <Button variant='outline' size='sm' onClick={() => setSecretDialogOpen(true)}>
                <Plus />
                Add Connection
              </Button>
            )
          )}
        </CardHeader>
        <CardContent>
          {appConnections.length === 0 ? (
            <div className='text-sm text-muted-foreground py-4 text-center'>
              No connections yet. Add a connection to get started.
            </div>
          ) : (
            <div className='divide-y'>
              {appConnections.map((conn) => (
                <div
                  key={conn.id}
                  className='flex items-center justify-between py-3 first:pt-0 last:pb-0'>
                  <div className='flex items-center gap-3'>
                    <StatusIcon status={conn.connectionStatus} />
                    <div>
                      {editingId === conn.id ? (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault()
                            handleRename(conn.id)
                          }}>
                          <InputGroup size='sm'>
                            <InputGroupInput
                              value={editLabel}
                              onChange={(e) => setEditLabel(e.target.value)}
                              className='h-7 w-48 text-sm'
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') setEditingId(null)
                              }}
                            />
                            <InputGroupAddon align='inline-end' className='gap-0.5'>
                              <InputGroupButton
                                type='submit'
                                size='icon-xs'
                                aria-label='Save'
                                title='Save'
                                disabled={!editLabel.trim()}>
                                <Check />
                              </InputGroupButton>
                              <InputGroupButton
                                type='button'
                                size='icon-xs'
                                aria-label='Cancel'
                                title='Cancel'
                                onClick={() => setEditingId(null)}>
                                <X />
                              </InputGroupButton>
                            </InputGroupAddon>
                          </InputGroup>
                        </form>
                      ) : (
                        <div className='text-sm font-medium'>{conn.label || conn.appName}</div>
                      )}
                      <div className='text-xs text-muted-foreground'>
                        {conn.connectionStatus === 'connected'
                          ? 'Connected'
                          : conn.connectionStatus === 'expired'
                            ? 'Token expired'
                            : 'Not connected'}
                        {conn.connectedBy && ` by ${conn.connectedBy}`}
                      </div>
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant='ghost' size='icon-sm'>
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align='end'>
                      <DropdownMenuItem onClick={() => handleStartEdit(conn.id, conn.label)}>
                        <Pencil />
                        Rename
                      </DropdownMenuItem>
                      {(conn.connectionStatus === 'expired' ||
                        conn.connectionStatus === 'connected') &&
                        isOAuth && (
                          <DropdownMenuItem onClick={() => handleReconnect(conn.id)}>
                            Reconnect
                          </DropdownMenuItem>
                        )}
                      <DropdownMenuItem
                        variant='destructive'
                        onClick={() => handleDisconnect(conn.id, conn.label)}>
                        <Unplug />
                        Disconnect
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <Dialog open={secretDialogOpen} onOpenChange={setSecretDialogOpen}>
        <DialogContent>
          <SecretConnectionDialogContent
            connectionLabel={app.app.title}
            connectionType={connectionType}
            secret={secret}
            setSecret={setSecret}
            showSecret={showSecret}
            setShowSecret={setShowSecret}
            saveSecret={saveSecret}
            handleSaveSecret={handleSaveSecret}
            onClose={() => setSecretDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>
      <Dialog open={variableDialogOpen} onOpenChange={setVariableDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connection Details</DialogTitle>
            <DialogDescription>
              Provide the following details to connect {app.app.title}.
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-4'>
            {connectionVarDefs.map((varDef) => (
              <Field key={varDef.key}>
                <FieldLabel>
                  {varDef.label}
                  {varDef.required !== false && <span className='text-destructive ml-1'>*</span>}
                </FieldLabel>
                <Input
                  type={varDef.secret ? 'password' : 'text'}
                  placeholder={varDef.placeholder}
                  value={variableValues[varDef.key] ?? ''}
                  onChange={(e) =>
                    setVariableValues((prev) => ({ ...prev, [varDef.key]: e.target.value }))
                  }
                />
                {varDef.description && <FieldDescription>{varDef.description}</FieldDescription>}
              </Field>
            ))}
            <div className='flex justify-end gap-2 pt-2'>
              <Button variant='ghost' onClick={() => setVariableDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleVariableSubmit}>Connect</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </div>
  )
}

export default AppConnections
