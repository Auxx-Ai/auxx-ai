// apps/web/src/components/apps/app-connection-status.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@auxx/ui/components/dialog'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@auxx/ui/components/field'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@auxx/ui/components/input-group'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { toastError } from '@auxx/ui/components/toast'
import { CheckCircle, Clock, Eye, EyeOff, XCircle } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
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
  returnTo,
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
  const oauthAuthorizeUrl = `/api/apps/${appSlug}/oauth2/authorize?installation=${installationId}&type=${connectionType}${returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : ''}`

  // Determine connection method
  const isOAuth = connectionDefinition?.connectionType === 'oauth2-code'
  const isSecret = connectionDefinition?.connectionType === 'secret'

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
      </div>
    )
  }

  // not_connected status
  return (
    <div className='flex items-center gap-2'>
      <XCircle className='h-4 w-4 text-gray-400' />
      <span className='text-sm text-gray-600'>Not connected</span>
      {isOAuth && (
        <Link href={oauthAuthorizeUrl}>
          <Button size='sm'>Connect {connectionLabel}</Button>
        </Link>
      )}

      {/* Secret connection dialog */}
      {isSecret && (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size='sm'>Connect {connectionLabel}</Button>
          </DialogTrigger>
          <DialogContent size='sm' position='tc'>
            <SecretConnectionDialogContent
              connectionLabel={connectionLabel}
              connectionType={connectionType}
              secret={secret}
              setSecret={setSecret}
              showSecret={showSecret}
              setShowSecret={setShowSecret}
              saveSecret={saveSecret}
              handleSaveSecret={handleSaveSecret}
              onClose={() => {
                setDialogOpen(false)
                setSecret('')
              }}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

/** Inner content props for SecretConnectionDialog */
interface SecretConnectionDialogContentProps {
  connectionLabel: string
  connectionType: 'user' | 'organization'
  secret: string
  setSecret: (value: string) => void
  showSecret: boolean
  setShowSecret: (value: boolean) => void
  saveSecret: ReturnType<typeof api.apps.saveSecretConnection.useMutation>
  handleSaveSecret: () => void
  onClose: () => void
}

/** Inner content component */
function SecretConnectionDialogContent({
  connectionLabel,
  connectionType,
  secret,
  setSecret,
  showSecret,
  setShowSecret,
  saveSecret,
  handleSaveSecret,
  onClose,
}: SecretConnectionDialogContentProps) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Connect {connectionLabel}</DialogTitle>
        <DialogDescription>
          Enter your API key to connect this {connectionType} connection.
        </DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor='secret'>API Key</FieldLabel>
          <InputGroup>
            <InputGroupInput
              id='secret'
              type={showSecret ? 'text' : 'password'}
              placeholder='Enter your API key'
              value={secret}
              autoComplete='off'
              onChange={(e) => setSecret(e.target.value)}
            />
            <InputGroupAddon align='inline-end'>
              <InputGroupButton
                aria-label={showSecret ? 'Hide API key' : 'Show API key'}
                title={showSecret ? 'Hide API key' : 'Show API key'}
                size='icon-xs'
                onClick={() => setShowSecret(!showSecret)}>
                {showSecret ? <EyeOff /> : <Eye />}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          <FieldDescription>
            Your API key will be encrypted and stored securely. It will be used to authenticate
            requests to {connectionLabel}.
          </FieldDescription>
        </Field>
      </FieldGroup>

      <DialogFooter>
        <Button variant='ghost' size='sm' onClick={onClose} disabled={saveSecret.isPending}>
          Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
        </Button>
        <Button
          variant='outline'
          size='sm'
          onClick={handleSaveSecret}
          loading={saveSecret.isPending}
          loadingText='Saving...'
          data-dialog-submit>
          Save Connection <KbdSubmit variant='outline' size='sm' />
        </Button>
      </DialogFooter>
    </>
  )
}
