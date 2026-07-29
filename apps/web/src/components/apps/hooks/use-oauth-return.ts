// apps/web/src/components/apps/hooks/use-oauth-return.ts

'use client'

import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect } from 'react'
import { api } from '~/trpc/react'

/**
 * Hook to handle OAuth return query params after redirect.
 *
 * Detects `oauth_success=true` or `oauth_error=true` in the URL:
 * - On success: invalidates `apps.listConnections` to refresh connection status, shows toast
 * - On error: shows error toast with the `oauth_error_message` param
 * - Cleans up params from the URL via `router.replace`
 */
export function useOAuthReturn() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const utils = api.useUtils()

  const oauthSuccess = searchParams.get('oauth_success')
  const oauthError = searchParams.get('oauth_error')
  const oauthErrorMessage = searchParams.get('oauth_error_message')
  // Set by the OAuth callback when the connect deduped onto an existing identity (update-in-place).
  const alreadyConnected = searchParams.get('already_connected')

  useEffect(() => {
    if (!oauthSuccess && !oauthError) return

    if (oauthSuccess === 'true') {
      toastSuccess(
        alreadyConnected === 'true'
          ? {
              title: 'Already connected',
              description: 'Already connected — reconnected the existing connection.',
            }
          : {
              title: 'Connection Successful',
              description: 'Your app has been connected successfully!',
            }
      )
      void utils.apps.listConnections.invalidate()
      void utils.apps.listInstalled.invalidate()
      // Channel reconnects (Gmail/Outlook) ride the same return path — refresh their list so a
      // cleared `requiresReauth` drops the "Auth required" badge without waiting out the staleTime.
      void utils.channel.list.invalidate()
      // A personal channel provisions its inbox inside the post-connect hook.
      void utils.inbox.settingsList.invalidate()
      void utils.record.listAll.invalidate()
    }

    if (oauthError === 'true') {
      toastError({
        title: 'Connection Failed',
        description: oauthErrorMessage || 'An error occurred during authentication.',
      })
    }

    // Clean up OAuth params from the URL
    const params = new URLSearchParams(searchParams.toString())
    params.delete('oauth_success')
    params.delete('oauth_error')
    params.delete('oauth_error_message')
    params.delete('already_connected')

    const remaining = params.toString()
    const cleanUrl = remaining
      ? `${window.location.pathname}?${remaining}`
      : window.location.pathname
    router.replace(cleanUrl)
  }, [oauthSuccess, oauthError, oauthErrorMessage, alreadyConnected, router, searchParams, utils])
}
