// apps/web/src/components/apps/use-oauth-return.ts

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

  useEffect(() => {
    if (!oauthSuccess && !oauthError) return

    if (oauthSuccess === 'true') {
      toastSuccess({
        title: 'Connection Successful',
        description: 'Your app has been connected successfully!',
      })
      void utils.apps.listConnections.invalidate()
      void utils.apps.listInstalled.invalidate()
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

    const remaining = params.toString()
    const cleanUrl = remaining
      ? `${window.location.pathname}?${remaining}`
      : window.location.pathname
    router.replace(cleanUrl)
  }, [oauthSuccess, oauthError, oauthErrorMessage, router, searchParams, utils])
}
