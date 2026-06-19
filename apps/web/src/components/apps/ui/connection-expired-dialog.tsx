// apps/web/src/components/apps/ui/connection-expired-dialog.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { toastError } from '@auxx/ui/components/toast'
import { Clock } from 'lucide-react'
import Link from 'next/link'
import { useMemo } from 'react'
import { ConnectionDetailDialog } from '~/components/connections/ui/connection-detail-dialog'
import type { DetailMethod } from '~/components/connections/ui/connection-detail-page'
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
  const utils = api.useUtils()

  const saveSecret = api.apps.saveSecretConnection.useMutation({
    onSuccess: () => {
      onOpenChange(false)
      // Refresh connection status, then notify parent to retry the operation.
      void utils.apps.listConnections.invalidate()
      onReconnected?.()
    },
    onError: (error) => {
      toastError({ title: 'Reconnection Failed', description: error.message })
    },
  })

  // Synthetic bare-secret method (single API key) backing the unified dialog.
  const secretMethod = useMemo<DetailMethod>(
    () => ({
      id: installationId,
      label: connectionLabel,
      description: null,
      connectionType: 'secret',
      global: scope === 'organization',
      connectionVariables: [],
    }),
    [installationId, connectionLabel, scope]
  )

  const isSecret = connectionType === 'secret'

  // Secret re-entry routes through the shared connect surface (no bespoke inline input).
  if (isSecret) {
    return (
      <ConnectionDetailDialog
        open={open}
        onOpenChange={onOpenChange}
        title={reason === 'missing' ? `Connect ${connectionLabel}` : `Reconnect ${connectionLabel}`}
        method={secretMethod}
        pending={saveSecret.isPending}
        submitLabel='Reconnect'
        onSubmit={(payload) =>
          saveSecret.mutate({
            appId,
            installationId,
            appName: connectionLabel,
            connectionType: scope,
            secret: payload.secret,
          })
        }
      />
    )
  }

  // OAuth: a direct re-authorize link (the popup flow isn't used in this fallback dialog).
  const oauthAuthorizeUrl = `/api/apps/${appSlug}/oauth2/authorize?installation=${installationId}&type=${scope}${returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : ''}`

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
          <div className='space-y-2'>
            <p className='text-sm text-muted-foreground'>
              Click the button below to reconnect your {scope} account via OAuth.
            </p>
            <Link href={oauthAuthorizeUrl}>
              <Button className='w-full'>Reconnect {connectionLabel}</Button>
            </Link>
          </div>
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
