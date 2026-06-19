// apps/web/src/components/apps/ui/app-connection-status.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { CheckCircle, Clock, XCircle } from 'lucide-react'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { ConnectionDetailDialog } from '~/components/connections/ui/connection-detail-dialog'
import type { DetailMethod } from '~/components/connections/ui/connection-detail-page'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'

interface AppConnectionStatusProps {
  appId: string
  appSlug: string
  installationId: string
  connectionStatus: 'connected' | 'not_connected' | 'expired'
  connectionLabel: string
  connectionType: 'user' | 'organization'
  credentialId?: string
  connectionDefinition?: {
    connectionType: 'oauth2-code' | 'secret' | 'none'
  }
  onConnectionSaved?: () => void
  /** Optional return URL appended to OAuth authorize URL (e.g., for workflow context) */
  returnTo?: string
}

/**
 * Compact status pill + connect/reconnect/disconnect controls for a single
 * connection. Used by surfaces that show one connection inline (workflow
 * panel header etc.).
 */
export function AppConnectionStatus({
  appId,
  appSlug,
  installationId,
  connectionStatus,
  connectionLabel,
  connectionType,
  credentialId,
  connectionDefinition,
  onConnectionSaved,
  returnTo,
}: AppConnectionStatusProps) {
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()
  const [dialogOpen, setDialogOpen] = useState(false)

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
      setDialogOpen(false)
      onConnectionSaved?.()
      void utils.apps.listConnections.invalidate()
      void utils.apps.listInstalled.invalidate()
    },
    onError: (error) => {
      toastError({ title: 'Failed to Save Connection', description: error.message })
    },
  })

  const handleDisconnect = async () => {
    if (!credentialId) return
    const confirmed = await confirm({
      title: 'Disconnect?',
      description: `Are you sure you want to disconnect ${connectionLabel}? This may affect app functionality.`,
      confirmText: 'Disconnect',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) {
      deleteConnection.mutate({ credentialId })
    }
  }

  const oauthAuthorizeUrl = `/api/apps/${appSlug}/oauth2/authorize?installation=${installationId}&type=${connectionType}${returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : ''}`

  const isOAuth = connectionDefinition?.connectionType === 'oauth2-code'
  const isSecret = connectionDefinition?.connectionType === 'secret'

  // Synthetic bare-secret method (single API key, no structured variables) for the unified dialog.
  const secretMethod = useMemo<DetailMethod>(
    () => ({
      id: credentialId ?? installationId,
      label: connectionLabel,
      description: null,
      connectionType: 'secret',
      global: connectionType === 'organization',
      connectionVariables: [],
    }),
    [credentialId, installationId, connectionLabel, connectionType]
  )

  const secretForm = isSecret ? (
    <ConnectionDetailDialog
      open={dialogOpen}
      onOpenChange={setDialogOpen}
      title={`Connect ${connectionLabel}`}
      method={secretMethod}
      pending={saveSecret.isPending}
      onSubmit={(payload) =>
        saveSecret.mutate({
          appId,
          installationId,
          appName: connectionLabel,
          connectionType,
          secret: payload.secret,
        })
      }
    />
  ) : null

  if (connectionStatus === 'connected') {
    return (
      <>
        <div className='flex items-center gap-2'>
          <CheckCircle className='h-4 w-4 text-green-500' />
          <span className='text-sm'>Connected</span>
          <Button
            variant='ghost'
            size='sm'
            onClick={handleDisconnect}
            loading={deleteConnection.isPending}>
            Disconnect
          </Button>
        </div>
        <ConfirmDialog />
      </>
    )
  }

  if (connectionStatus === 'expired') {
    return (
      <div className='flex items-center gap-2'>
        <Clock className='h-4 w-4 text-yellow-500' />
        <span className='text-sm'>Token expired</span>
        {isOAuth && (
          <Link href={oauthAuthorizeUrl}>
            <Button size='sm'>Reconnect</Button>
          </Link>
        )}
        {isSecret && (
          <Button size='sm' onClick={() => setDialogOpen(true)}>
            Reconnect
          </Button>
        )}
        {secretForm}
      </div>
    )
  }

  return (
    <div className='flex items-center gap-2'>
      <XCircle className='h-4 w-4 text-gray-400' />
      <span className='text-sm text-gray-600'>Not connected</span>
      {isOAuth && (
        <Link href={oauthAuthorizeUrl}>
          <Button size='sm'>Connect {connectionLabel}</Button>
        </Link>
      )}
      {isSecret && (
        <Button size='sm' onClick={() => setDialogOpen(true)}>
          Connect {connectionLabel}
        </Button>
      )}
      {secretForm}
    </div>
  )
}
