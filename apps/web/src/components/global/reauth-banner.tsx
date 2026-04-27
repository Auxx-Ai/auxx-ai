// ~/components/global/reauth-banner.tsx
'use client'

import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { AlertTriangle, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import { useIsSmallScreen } from '~/hooks/use-small-screen'
import { api } from '~/trpc/react'

interface ReauthBannerProps {
  integration: {
    id: string
    provider: string
    email?: string
    name?: string
    lastAuthError?: string
    lastAuthErrorAt?: Date
    requiresReauth?: boolean
    metadata?: unknown
  }
  onDismiss?: () => void
  className?: string
}

/**
 * Detect Google Workspace RAPT (Reauthentication Policy Token) failures.
 * These come from a Workspace admin policy that expires sessions for sensitive
 * scopes, *not* a revoked refresh token — the user can keep reauthing daily
 * forever unless their admin extends the Google Cloud session length.
 *
 * @see https://support.google.com/a/answer/9368756
 */
function isRaptFailure(integration: ReauthBannerProps['integration']): boolean {
  if (integration.provider !== 'google') return false
  const subtype = (integration.metadata as any)?.auth?.googleErrorSubtype
  if (subtype === 'invalid_rapt') return true
  const lastErr = integration.lastAuthError?.toLowerCase() ?? ''
  return lastErr.includes('invalid_rapt') || lastErr.includes('reauth related error')
}

/**
 * Re-authentication banner component with mobile-first design
 * Displays when OAuth2 token refresh fails and user needs to re-authenticate
 */
export function ReauthBanner({ integration, onDismiss, className }: ReauthBannerProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [isReauthenticating, setIsReauthenticating] = useState(false)
  const router = useRouter()
  const isSmallScreen = useIsSmallScreen()
  const [confirm, ConfirmDialog] = useConfirm()

  // Mutation to trigger re-authentication
  const reauthMutation = api.channelReauth.initiateReauth.useMutation({
    onSuccess: (data) => {
      if (data.authUrl) {
        // Redirect to OAuth provider
        window.location.href = data.authUrl
      } else {
        toastSuccess({
          title: 'Re-authentication initiated',
          description: 'Please complete the authentication process',
        })
      }
    },
    onError: (error) => {
      toastError({ title: 'Failed to start re-authentication', description: error.message })
      setIsReauthenticating(false)
    },
  })

  const handleReauthenticate = async () => {
    const confirmed = await confirm({
      title: 'Re-authenticate Integration?',
      description: `This will redirect you to ${getProviderName(integration.provider)} to grant permissions again. Your current settings will be preserved.`,
      confirmText: 'Continue',
      cancelText: 'Cancel',
    })

    if (confirmed) {
      setIsReauthenticating(true)
      reauthMutation.mutate({ integrationId: integration.id })
    }
  }

  const formatErrorTime = (date?: Date) => {
    if (!date) return 'Unknown'
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    const diffDays = Math.floor(diffHours / 24)

    if (diffDays > 0) {
      return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`
    } else if (diffHours > 0) {
      return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`
    } else {
      return 'Just now'
    }
  }

  if (!integration.requiresReauth) {
    return null
  }

  const isRapt = isRaptFailure(integration)

  return (
    <>
      <Alert
        variant='destructive'
        className={cn(
          'relative border-red-200 bg-red-50 dark:bg-red-950/30 rounded-none border-x-0 border-t-0',
          // Mobile optimizations
          'mx-auto max-w-full overflow-hidden',
          isSmallScreen && 'rounded-none p-3',
          className
        )}>
        <div className='flex items-start gap-3'>
          <AlertTriangle
            className={cn(
              'text-red-600 dark:text-red-400 flex-shrink-0 size-4',
              isSmallScreen && 'mt-0.5'
            )}
          />

          <div className='flex-1 min-w-0'>
            <div className='flex flex-col gap-2'>
              {/* Header Row */}
              <div
                className={cn(
                  'flex items-start justify-between gap-2',
                  isSmallScreen && 'flex-col gap-1'
                )}>
                <div className='flex-1 min-w-0'>
                  <div className='flex items-center gap-2 flex-wrap'>Authentication Required</div>
                </div>
              </div>

              {/* Description */}
              <AlertDescription
                className={cn(
                  'text-red-800 dark:text-red-200',
                  isSmallScreen ? 'text-xs leading-relaxed' : 'text-sm'
                )}>
                {isRapt ? (
                  <>
                    Your Google Workspace admin enforces periodic re-authentication for this
                    account. Reconnect now to resume sync — and to stop the recurring prompts, ask
                    your Workspace admin to extend{' '}
                    <a
                      href='https://admin.google.com/ac/security/contextawareaccess/sessioncontrols'
                      target='_blank'
                      rel='noopener noreferrer'
                      className='underline font-medium'>
                      Google Cloud session control
                    </a>{' '}
                    (Security → Access and data control) to{' '}
                    <span className='font-medium'>Session never expires</span>.
                  </>
                ) : (
                  <>
                    Email sync has stopped working due to expired authentication. Please
                    re-authenticate to resume email processing.
                  </>
                )}
              </AlertDescription>

              {/* Action Buttons */}
              <div
                className={cn(
                  'flex gap-2 pt-1',
                  isSmallScreen ? 'flex-col' : 'flex-row items-center'
                )}>
                <Button
                  variant='outline'
                  onClick={handleReauthenticate}
                  disabled={isReauthenticating || reauthMutation.isPending}
                  loading={isReauthenticating}
                  size='sm'>
                  <ExternalLink />
                  Re-authenticate Now
                </Button>

                <Button variant='outline' size='sm' onClick={() => setIsExpanded(!isExpanded)}>
                  {isExpanded ? (
                    <>
                      Less Details <ChevronDown />
                    </>
                  ) : (
                    <>
                      More Details <ChevronRight />
                    </>
                  )}
                </Button>
              </div>

              {/* Expandable Error Details */}
              {isExpanded && integration.lastAuthError && (
                <div
                  className={cn(
                    'mt-3 p-3 bg-red-100 dark:bg-red-900/50 rounded-md border border-red-200 dark:border-red-800',
                    isSmallScreen && 'text-xs'
                  )}>
                  <h4 className='font-medium text-red-800 dark:text-red-200 mb-1'>
                    Technical Details:
                  </h4>
                  <code className='text-red-700 dark:text-red-300 break-all'>
                    {integration.lastAuthError}
                  </code>
                </div>
              )}
            </div>
          </div>
        </div>
      </Alert>

      <ConfirmDialog />
    </>
  )
}

/**
 * Get provider display name
 */
function getProviderName(provider: string): string {
  switch (provider.toLowerCase()) {
    case 'google':
      return 'Gmail'
    case 'outlook':
      return 'Outlook'
    case 'facebook':
      return 'Facebook'
    case 'instagram':
      return 'Instagram'
    case 'openphone':
      return 'OpenPhone'
    default:
      return provider.charAt(0).toUpperCase() + provider.slice(1)
  }
}
