// app/api/outlook/oauth2/callback/route.ts

import { WEBAPP_URL } from '@auxx/config/server'
import { consumeOAuthCsrfToken } from '@auxx/lib/cache'
import { publisher } from '@auxx/lib/events'
import { OutlookOAuthService } from '@auxx/lib/providers'
import { createScopedLogger } from '@auxx/logger'
import { validateRedirectPath } from '@auxx/utils'
import { headers } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '~/auth/server'

const logger = createScopedLogger('outlook-oauth-callback')

const DEFAULT_REDIRECT = '/app/settings/channels/new/outlook/result'

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')
  const errorDescription = searchParams.get('error_description')

  let redirectPath = DEFAULT_REDIRECT
  let parsedState: Record<string, unknown> | undefined

  // --- Session Verification (CSRF protection) ---
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.redirect(
      new URL(`/login?callbackUrl=${encodeURIComponent(req.url)}`, req.url)
    )
  }

  // --- State Parameter Handling ---
  try {
    if (state) {
      parsedState = JSON.parse(state)
      redirectPath = validateRedirectPath(
        parsedState?.redirectPath as string | undefined,
        DEFAULT_REDIRECT
      )
    }
  } catch (e) {
    logger.error('Failed to parse state parameter in Outlook callback', { state, error: e })
    return NextResponse.redirect(
      new URL(
        `${redirectPath}?error=invalid_state&error_description=${encodeURIComponent('Invalid state parameter received.')}`,
        WEBAPP_URL
      )
    )
  }

  // --- Verify user matches the one who initiated the flow ---
  if (session.user.id !== parsedState?.userId) {
    logger.error('User mismatch in Outlook OAuth callback', {
      sessionUserId: session.user.id,
      stateUserId: parsedState?.userId,
    })
    return NextResponse.redirect(
      new URL(`/login?callbackUrl=${encodeURIComponent(req.url)}`, req.url)
    )
  }

  // --- CSRF token verification (Redis-based) ---
  const storedToken = await consumeOAuthCsrfToken(session.user.id)
  if (!storedToken || storedToken !== parsedState?.csrfToken) {
    logger.error('CSRF token mismatch in Outlook OAuth callback')
    return NextResponse.redirect(
      new URL(
        `${redirectPath}?error=csrf_mismatch&error_description=${encodeURIComponent('CSRF verification failed. Please try again.')}`,
        WEBAPP_URL
      )
    )
  }

  // --- Handle OAuth errors or missing code ---
  if (error || !code || !state) {
    const errorMessage = errorDescription || error || 'missing_code'
    logger.warn('OAuth error or missing code in Outlook callback', {
      error,
      errorDescription,
      state,
    })
    return NextResponse.redirect(
      new URL(
        `${redirectPath}?error=${encodeURIComponent(error || 'oauth_error')}&error_description=${encodeURIComponent(errorMessage)}`,
        WEBAPP_URL
      )
    )
  }

  try {
    const result = await OutlookOAuthService.handleCallback(code, state)

    // Extract identifier (email) from metadata for the redirect URL
    let identifier = 'unknown'
    if (
      result.integration.metadata &&
      typeof result.integration.metadata === 'object' &&
      'email' in result.integration.metadata
    ) {
      identifier = result.integration.metadata.email as string
    }

    logger.info('Outlook OAuth callback successful', {
      integrationId: result.integration.id,
      identifier,
    })

    await publisher.publishLater({
      type: 'integration:connected',
      data: {
        organizationId: parsedState?.orgId,
        userId: parsedState?.userId,
        provider: 'outlook',
        identifier,
        integrationId: result.integration.id,
      },
    })

    return NextResponse.redirect(
      new URL(
        `${redirectPath}?success=true&identifier=${encodeURIComponent(identifier)}&integrationId=${result.integration.id}`,
        WEBAPP_URL
      )
    )
  } catch (error: any) {
    logger.error('Error processing Outlook OAuth callback:', {
      error: error.message,
      stack: error.stack,
    })

    await publisher.publishLater({
      type: 'integration:connection_failed',
      data: {
        organizationId: parsedState?.orgId,
        userId: parsedState?.userId,
        provider: 'outlook',
        error: error.message || 'Failed to complete Microsoft authorization',
      },
    })

    return NextResponse.redirect(
      new URL(
        `${redirectPath}?error=oauth_failed&error_description=${encodeURIComponent(error.message || 'Failed to complete Microsoft authorization')}`,
        WEBAPP_URL
      )
    )
  }
}
