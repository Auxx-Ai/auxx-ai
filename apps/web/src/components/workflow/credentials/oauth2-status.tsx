// apps/web/src/app/(protected)/app/workflows/_components/credentials/oauth2-status.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import type { OAuth2CredentialData } from '@auxx/workflow-nodes/types'
import * as Icons from 'lucide-react'
import { AlertCircle, CheckCircle, type LucideIcon, RefreshCw } from 'lucide-react'
import { api } from '~/trpc/react'

interface OAuth2StatusProps {
  /** Credential ID */
  credentialId: string

  /** Credential data (decrypted) */
  credentialData: OAuth2CredentialData

  /** Provider icon name */
  providerIcon: string

  /** Provider display name */
  providerName: string

  /** Whether refresh is currently in progress */
  isRefreshing?: boolean

  /** Called when tokens are refreshed successfully */
  onRefresh?: () => void
}

/**
 * OAuth2 credential status display component
 * Shows connection status, user info, and refresh functionality
 */
export function OAuth2Status({
  credentialId,
  credentialData,
  providerIcon,
  providerName,
  isRefreshing = false,
  onRefresh,
}: OAuth2StatusProps) {
  // Get the provider icon component
  const IconComponent = getIconComponent(providerIcon)

  // Check if tokens are expired or expiring soon
  const isExpired = credentialData.expiresAt
    ? new Date(credentialData.expiresAt) < new Date()
    : false
  const isExpiringSoon = credentialData.expiresAt
    ? new Date(credentialData.expiresAt) < new Date(Date.now() + 24 * 60 * 60 * 1000)
    : false // 24 hours

  // tRPC mutation for token refresh
  const refreshTokens = api.credentials.refreshOAuthTokens.useMutation({
    onSuccess: () => {
      toastSuccess({
        title: 'Tokens refreshed',
        description: `${providerName} tokens have been refreshed successfully`,
      })
      onRefresh?.()
    },
    onError: (error) => {
      toastError({
        title: 'Failed to refresh tokens',
        description: error.message,
      })
    },
  })

  const handleRefresh = async () => {
    await refreshTokens.mutateAsync({ credentialId })
  }

  // Get connection status
  const getConnectionStatus = () => {
    if (isExpired) {
      return {
        variant: 'destructive' as const,
        icon: AlertCircle,
        text: 'Expired',
        description: 'Tokens have expired and need to be refreshed',
      }
    }

    if (isExpiringSoon) {
      return {
        variant: 'secondary' as const,
        icon: AlertCircle,
        text: 'Expiring Soon',
        description: 'Tokens will expire within 24 hours',
      }
    }

    return {
      variant: 'default' as const,
      icon: CheckCircle,
      text: 'Connected',
      description: 'Credential is active and ready to use',
    }
  }

  const status = getConnectionStatus()
  const StatusIcon = status.icon

  return (
    <div className='space-y-4'>
      {/* Connection Status */}
      <div className='flex items-center justify-between'>
        <div className='flex items-center space-x-3'>
          <IconComponent className='w-5 h-5 text-muted-foreground' />
          <div>
            <div className='flex items-center space-x-2'>
              <span className='font-medium'>{providerName}</span>
              <Badge variant={status.variant} className='flex items-center space-x-1'>
                <StatusIcon className='w-3 h-3' />
                <span>{status.text}</span>
              </Badge>
            </div>
            <p className='text-sm text-muted-foreground mt-1'>{status.description}</p>
          </div>
        </div>

        {/* Refresh Button */}
        {credentialData.refreshToken && (
          <Button
            variant='outline'
            size='sm'
            onClick={handleRefresh}
            disabled={refreshTokens.isPending || isRefreshing}
            loading={refreshTokens.isPending || isRefreshing}
            loadingText='Refreshing...'>
            <RefreshCw className='w-4 h-4 mr-2' />
            Refresh
          </Button>
        )}
      </div>

      {/* User Information */}
      {credentialData.metadata?.email && (
        <div className='bg-muted/50 rounded-lg p-3'>
          <div className='text-sm'>
            <div className='font-medium text-muted-foreground mb-1'>Connected Account</div>
            <div className='text-foreground'>{credentialData.metadata.email}</div>
          </div>
        </div>
      )}

      {/* Scopes Information */}
      {credentialData.scopes && credentialData.scopes.length > 0 && (
        <div>
          <div className='text-sm font-medium text-muted-foreground mb-2'>Permissions</div>
          <div className='grid grid-cols-1 sm:grid-cols-2 gap-2'>
            {credentialData.scopes.map((scope, index) => (
              <div key={index} className='text-xs bg-muted/30 rounded px-2 py-1'>
                {getScopeDisplayName(scope)}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Expiration Information */}
      {credentialData.expiresAt && (
        <div className='text-xs text-muted-foreground'>
          <span className='font-medium'>Expires:</span>{' '}
          {new Date(credentialData.expiresAt).toLocaleString()}
        </div>
      )}
    </div>
  )
}

/**
 * Get icon component from lucide-react
 */
function getIconComponent(iconName: string): LucideIcon {
  const IconComponent = (Icons as any)[iconName] as LucideIcon
  return IconComponent || Icons.Key // Fallback to Key icon
}

/**
 * Get human-readable display name for OAuth scopes
 */
function getScopeDisplayName(scope: string): string {
  const scopeNames: Record<string, string> = {
    // Google scopes
    'https://www.googleapis.com/auth/gmail.modify': 'Gmail',
    'https://www.googleapis.com/auth/drive': 'Google Drive',
    'https://www.googleapis.com/auth/spreadsheets': 'Google Sheets',
    'https://www.googleapis.com/auth/calendar': 'Google Calendar',
    'https://www.googleapis.com/auth/userinfo.email': 'Email Address',
    'https://www.googleapis.com/auth/userinfo.profile': 'Profile Info',

    // Microsoft scopes (for future use)
    'https://graph.microsoft.com/mail.read': 'Email Read',
    'https://graph.microsoft.com/mail.send': 'Email Send',
    'https://graph.microsoft.com/files.readwrite': 'OneDrive Files',

    // GitHub scopes (for future use)
    repo: 'Repositories',
    'user:email': 'Email Addresses',
    'read:user': 'User Profile',
  }

  return scopeNames[scope] || scope
}
