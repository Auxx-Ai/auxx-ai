// apps/web/src/components/apps/connection-expired-dialog.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@auxx/ui/components/input-group'
import { toastError } from '@auxx/ui/components/toast'
import { Clock, Eye, EyeOff } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { api } from '~/trpc/react'

interface ConnectionExpiredDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  appId: string
  appSlug: string
  appName: string
  installationId: string
  scope: 'user' | 'organization'
  connectionType: 'oauth2-code' | 'secret'
  connectionLabel: string
  reason?: 'expired' | 'missing'
  onReconnected?: () => void
  /** Optional return URL appended to OAuth authorize URL (e.g., for workflow context) */
  returnTo?: string
}

/**
 * Dialog component for reconnecting expired app connections
 *
 * This dialog appears when a server function execution fails due to an expired
 * connection token. It allows the user to reconnect without navigating away from
 * the current page.
 */
export function ConnectionExpiredDialog({
  open,
  onOpenChange,
  appId,
  appSlug,
  appName,
  installationId,
  scope,
  connectionType,
  connectionLabel,
  reason = 'expired',
  onReconnected,
  returnTo,
}: ConnectionExpiredDialogProps) {
  const [secret, setSecret] = useState('')
  const [showSecret, setShowSecret] = useState(false)

  const utils = api.useUtils()

  const saveSecret = api.apps.saveSecretConnection.useMutation({
    onSuccess: () => {
      setSecret('')
      onOpenChange(false)

      // Invalidate queries to refresh connection status
      void utils.apps.listConnections.invalidate()

      // Notify parent to retry operation
      onReconnected?.()
    },
    onError: (error) => {
      toastError({
        title: 'Reconnection Failed',
        description: error.message,
      })
    },
  })

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
      connectionType: scope,
      secret: secret.trim(),
    })
  }

  // Build OAuth authorize URL
  const oauthAuthorizeUrl = `/api/apps/${appSlug}/oauth2/authorize?installation=${installationId}&type=${scope}${returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : ''}`

  const isOAuth = connectionType === 'oauth2-code'
  const isSecret = connectionType === 'secret'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size='sm' position='tc'>
        <DialogHeader>
          <div className='flex items-center gap-2 mb-2'>
            <Clock className='h-5 w-5 text-yellow-500' />
            <DialogTitle>
              {reason === 'missing' ? 'Connection Required' : 'Connection Expired'}
            </DialogTitle>
          </div>
          <DialogDescription>
            {reason === 'missing'
              ? `Your ${scope} connection to ${appName} is not set up. Please connect to continue using this feature.`
              : `Your ${scope} connection to ${appName} has expired. Please reconnect to continue using this feature.`}
          </DialogDescription>
        </DialogHeader>

        <div className='py-4 space-y-4'>
          {isOAuth && (
            <div className='space-y-2'>
              <p className='text-sm text-muted-foreground'>
                Click the button below to reconnect your {scope} account via OAuth.
              </p>
              <Link href={oauthAuthorizeUrl}>
                <Button className='w-full'>Reconnect {connectionLabel}</Button>
              </Link>
            </div>
          )}

          {isSecret && (
            <div className='space-y-2'>
              <label htmlFor='secret' className='text-sm font-medium'>
                API Key
              </label>
              <InputGroup>
                <InputGroupInput
                  id='secret'
                  type={showSecret ? 'text' : 'password'}
                  placeholder='Enter your API key'
                  value={secret}
                  autoComplete='off'
                  onChange={(e) => setSecret(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !saveSecret.isPending) {
                      handleSaveSecret()
                    }
                  }}
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
              <p className='text-xs text-muted-foreground'>
                Your API key will be encrypted and stored securely.
              </p>

              <div className='flex gap-2 pt-2'>
                <Button
                  variant='ghost'
                  className='flex-1'
                  onClick={() => {
                    onOpenChange(false)
                    setSecret('')
                  }}
                  disabled={saveSecret.isPending}>
                  Cancel
                </Button>
                <Button
                  variant='outline'
                  className='flex-1'
                  onClick={handleSaveSecret}
                  loading={saveSecret.isPending}
                  loadingText='Saving...'>
                  Reconnect
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className='border-t pt-4'>
          <p className='text-xs text-muted-foreground'>
            You can also manage connections in{' '}
            <Link
              href={`/app/settings/apps/installed/${appSlug}/connections`}
              className='text-primary hover:underline'
              onClick={() => onOpenChange(false)}>
              App Settings
            </Link>
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
