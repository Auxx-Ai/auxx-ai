// apps/web/src/app/(protected)/app/workflows/credentials/page.tsx
'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

/**
 * Redirect page for /app/workflows/credentials
 * This exists to handle the route conflict with [workflowId]
 * Redirects to the main workflows page with credentials tab active
 */
export default function CredentialsRedirectPage() {
  const router = useRouter()

  useEffect(() => {
    // Preserve any query parameters from the original URL
    const currentUrl = new URL(window.location.href)
    const searchParams = currentUrl.searchParams

    // Redirect to main workflows page with credentials tab
    const redirectUrl = new URL('/app/workflows', window.location.origin)
    redirectUrl.searchParams.set('t', 'credentials')

    // Preserve OAuth success/error parameters
    const oauthSuccess = searchParams.get('oauth_success')
    const credentialId = searchParams.get('credential_id')
    const userEmail = searchParams.get('user_email')
    const oauthError = searchParams.get('oauth_error')
    const errorDescription = searchParams.get('oauth_error_description')

    if (oauthSuccess) {
      redirectUrl.searchParams.set('oauth_success', oauthSuccess)
    }
    if (credentialId) {
      redirectUrl.searchParams.set('credential_id', credentialId)
    }
    if (userEmail) {
      redirectUrl.searchParams.set('user_email', userEmail)
    }
    if (oauthError) {
      redirectUrl.searchParams.set('oauth_error', oauthError)
    }
    if (errorDescription) {
      redirectUrl.searchParams.set('oauth_error_description', errorDescription)
    }

    router.replace(redirectUrl.toString())
  }, [router])

  return (
    <div className='flex items-center justify-center h-64'>
      <div className='text-muted-foreground'>Redirecting to credentials...</div>
    </div>
  )
}
