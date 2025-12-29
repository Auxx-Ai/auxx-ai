// apps/web/src/components/apps/app-connection-status.tsx

'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@auxx/ui/components/button'
import { Field, FieldGroup, FieldLabel, FieldDescription } from '@auxx/ui/components/field'
import { CheckCircle, XCircle, Clock, Eye, EyeOff } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@auxx/ui/components/dialog'
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
  InputGroupButton,
} from '@auxx/ui/components/input-group'
import { api } from '~/trpc/react'
import { toastError } from '@auxx/ui/components/toast'
import { useConfirm } from '~/hooks/use-confirm'

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
}

/**
 * Component to display and manage app connection status
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
}: AppConnectionStatusProps) {
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [secret, setSecret] = useState('')
  const [showSecret, setShowSecret] = useState(false)

  const deleteConnection = api.apps.deleteConnection.useMutation({
    onSuccess: () => {
      // Refetch connections and installed apps
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
      setSecret('')
      // Call parent callback if provided
      onConnectionSaved?.()
      // Also invalidate queries for consistency
      void utils.apps.listConnections.invalidate()
      void utils.apps.listInstalled.invalidate()
    },
    onError: (error) => {
      toastError({
        title: 'Failed to Save Connection',
        description: error.message,
      })
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

  const handleSaveSecret = () => {
    if (!secret.trim()) {
      toastError({
        title: 'Validation Error',
        description: 'Please enter an API key.',
      })
      return
    }

    saveSecret.mutate({
      appId,
      installationId,
      appName: connectionLabel,
      connectionType,
      secret: secret.trim(),
    })
  }

  // Build OAuth authorize URL using app slug
  const oauthAuthorizeUrl = `/api/apps/${appSlug}/oauth2/authorize?installation=${installationId}&type=${connectionType}`

  // Determine connection method
  const isOAuth = connectionDefinition?.connectionType === 'oauth2-code'
  const isSecret = connectionDefinition?.connectionType === 'secret'

  if (connectionStatus === 'connected') {
    return (
      <>
        <div className="flex items-center gap-2">
          <CheckCircle className="h-4 w-4 text-green-500" />
          <span className="text-sm">Connected</span>
          <Button
            variant="ghost"
            size="sm"
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
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4 text-yellow-500" />
        <span className="text-sm">Token expired</span>
        {isOAuth && (
          <Link href={oauthAuthorizeUrl}>
            <Button size="sm">Reconnect</Button>
          </Link>
        )}
        {isSecret && (
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            Reconnect
          </Button>
        )}
      </div>
    )
  }

  // not_connected status
  return (
    <>
      <div className="flex items-center gap-2">
        <XCircle className="h-4 w-4 text-gray-400" />
        <span className="text-sm text-gray-600">Not connected</span>
        {isOAuth && (
          <Link href={oauthAuthorizeUrl}>
            <Button size="sm">Connect {connectionLabel}</Button>
          </Link>
        )}

        {/* Secret connection dialog */}
        {isSecret && (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm">Connect {connectionLabel}</Button>
            </DialogTrigger>
            <DialogContent size="sm" position="tc">
              <DialogHeader>
                <DialogTitle>Connect {connectionLabel}</DialogTitle>
                <DialogDescription>
                  Enter your API key to connect this {connectionType} connection.
                </DialogDescription>
              </DialogHeader>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="secret">API Key</FieldLabel>
                  <InputGroup>
                    <InputGroupInput
                      id="secret"
                      type={showSecret ? 'text' : 'password'}
                      placeholder="Enter your API key"
                      value={secret}
                      autoComplete="off"
                      onChange={(e) => setSecret(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !saveSecret.isPending) {
                          handleSaveSecret()
                        }
                      }}
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton
                        aria-label={showSecret ? 'Hide API key' : 'Show API key'}
                        title={showSecret ? 'Hide API key' : 'Show API key'}
                        size="icon-xs"
                        onClick={() => setShowSecret(!showSecret)}>
                        {showSecret ? <EyeOff /> : <Eye />}
                      </InputGroupButton>
                    </InputGroupAddon>
                  </InputGroup>
                  <FieldDescription>
                    Your API key will be encrypted and stored securely. It will be used to
                    authenticate requests to {connectionLabel}.
                  </FieldDescription>
                </Field>
              </FieldGroup>

              <DialogFooter>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDialogOpen(false)
                    setSecret('')
                  }}
                  disabled={saveSecret.isPending}>
                  Cancel
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSaveSecret}
                  loading={saveSecret.isPending}
                  loadingText="Saving...">
                  Save Connection
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>
    </>
  )
}
