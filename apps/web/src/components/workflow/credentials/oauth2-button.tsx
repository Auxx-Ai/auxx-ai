// apps/web/src/app/(protected)/app/workflows/_components/credentials/oauth2-button.tsx

'use client'

import { useState } from 'react'
import { Button } from '@auxx/ui/components/button'
import { api } from '~/trpc/react'
import { toastSuccess, toastError } from '@auxx/ui/components/toast'
import { LucideIcon } from 'lucide-react'
import * as Icons from 'lucide-react'
import type { ICredentialType, OAuth2Config } from '@auxx/workflow-nodes/types'

interface OAuth2ButtonProps {
  /** Credential type with OAuth2 configuration */
  credentialType: ICredentialType & { oauth2Config: OAuth2Config }

  /** User-provided name for the credential */
  credentialName: string

  /** Called when OAuth flow completes successfully */
  onSuccess: (credentialId: string, userInfo?: { email?: string; name?: string }) => void

  /** Called when OAuth flow fails */
  onError: (error: string) => void

  /** Whether the button should be disabled */
  disabled?: boolean

  /** Custom button text (defaults to "Connect to [Provider]") */
  buttonText?: string
}

/**
 * Generic OAuth2 authentication button
 * Works with any OAuth2 provider configured in credential definitions
 */
export function OAuth2Button({
  credentialType,
  credentialName,
  onSuccess,
  onError,
  disabled = false,
  buttonText,
}: OAuth2ButtonProps) {
  const [isConnecting, setIsConnecting] = useState(false)

  // Get the provider icon component
  const IconComponent = getIconComponent(credentialType.oauth2Config.icon)

  // Generate button text
  const displayText =
    buttonText || `Connect to ${credentialType.displayName.replace(' OAuth2', '')}`

  // tRPC mutations
  const initiateOAuth = api.credentials.initiateOAuth.useMutation({
    onSuccess: (data) => {
      // Redirect to OAuth provider
      window.location.href = data.authUrl
    },
    onError: (error) => {
      setIsConnecting(false)
      toastError({
        title: 'Failed to start authentication',
        description: error.message,
      })
      onError(error.message)
    },
  })

  const handleOAuthCallback = api.credentials.handleOAuthCallback.useMutation({
    onSuccess: (data) => {
      setIsConnecting(false)

      if (data.success && data.credentialId) {
        toastSuccess({
          title: 'Authentication successful',
          description: `Connected to ${credentialType.displayName.replace(' OAuth2', '')} as ${data.userInfo?.email || 'user'}`,
        })
        onSuccess(data.credentialId, data.userInfo)
      } else {
        const errorMsg = data.error || 'Unknown error occurred'
        toastError({
          title: 'Authentication failed',
          description: errorMsg,
        })
        onError(errorMsg)
      }
    },
    onError: (error) => {
      setIsConnecting(false)
      toastError({
        title: 'Authentication failed',
        description: error.message,
      })
      onError(error.message)
    },
  })

  // Handle OAuth initiation
  const handleConnect = async () => {
    if (!credentialName.trim()) {
      toastError({
        title: 'Credential name required',
        description: 'Please enter a name for this credential',
      })
      return
    }

    setIsConnecting(true)

    try {
      // Check if we're returning from OAuth callback
      const urlParams = new URLSearchParams(window.location.search)
      const code = urlParams.get('code')
      const state = urlParams.get('state')
      const error = urlParams.get('error')

      if (error) {
        throw new Error(`OAuth error: ${error}`)
      }

      if (code && state) {
        // Handle OAuth callback
        await handleOAuthCallback.mutateAsync({ code, state })

        // Clean up URL parameters
        const newUrl = new URL(window.location.href)
        newUrl.search = ''
        window.history.replaceState({}, '', newUrl.toString())
      } else {
        // Initiate OAuth flow
        console.log(credentialType.name)
        await initiateOAuth.mutateAsync({
          credentialType: credentialType.name,
          credentialName: credentialName.trim(),
        })
      }
    } catch (error) {
      setIsConnecting(false)
      const errorMsg = error instanceof Error ? error.message : 'Unknown error occurred'
      toastError({
        title: 'Authentication failed',
        description: errorMsg,
      })
      onError(errorMsg)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center space-x-2 text-sm text-muted-foreground">
        <IconComponent />
        <span>
          This will connect to your {credentialType.displayName.replace(' OAuth2', '')} account
          using secure OAuth2 authentication.
        </span>
      </div>

      <Button
        onClick={handleConnect}
        disabled={disabled || isConnecting || !credentialName.trim()}
        loading={isConnecting}
        loadingText="Connecting..."
        className="w-full"
        variant="default">
        <IconComponent />
        {displayText}
      </Button>

      {credentialType.oauth2Config.scopes.length > 0 && (
        <div className="text-xs text-muted-foreground">
          <div className="font-medium mb-1">This credential will have access to:</div>
          <ul className="space-y-1">
            {getScopeDescriptions(credentialType.oauth2Config).map((scope, index) => (
              <li key={index} className="flex items-start space-x-2">
                <span className="text-green-500 mt-0.5">•</span>
                <span>{scope}</span>
              </li>
            ))}
          </ul>
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
 * Get human-readable descriptions for OAuth scopes
 */
function getScopeDescriptions(oauth2Config: OAuth2Config): string[] {
  const scopeDescriptions: Record<string, string> = {
    // Google scopes
    'https://www.googleapis.com/auth/gmail.modify': 'Read and send emails in Gmail',
    'https://www.googleapis.com/auth/drive': 'Access Google Drive files',
    'https://www.googleapis.com/auth/spreadsheets': 'Read and edit Google Sheets',
    'https://www.googleapis.com/auth/calendar': 'Access Google Calendar events',
    'https://www.googleapis.com/auth/userinfo.email': 'Access your email address',
    'https://www.googleapis.com/auth/userinfo.profile': 'Access your basic profile info',

    // Microsoft scopes (for future use)
    'https://graph.microsoft.com/mail.read': 'Read your email',
    'https://graph.microsoft.com/mail.send': 'Send emails on your behalf',
    'https://graph.microsoft.com/files.readwrite': 'Access your OneDrive files',

    // GitHub scopes (for future use)
    repo: 'Access your repositories',
    'user:email': 'Access your email addresses',
    'read:user': 'Read your profile information',
  }

  return oauth2Config.scopes.map((scope) => scopeDescriptions[scope] || scope)
}
