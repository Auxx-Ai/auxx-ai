// src/app/api/instagram/oauth2/callback/route.ts

import { WEBAPP_URL } from '@auxx/config/server'
import { consumeOAuthCsrfToken } from '@auxx/lib/cache'
import { publisher } from '@auxx/lib/events'
import type { InstagramIntegrationMetadata } from '@auxx/lib/providers'
import { InstagramOAuthService } from '@auxx/lib/providers'
import { createScopedLogger } from '@auxx/logger'
import { validateRedirectPath } from '@auxx/utils'
import { headers } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '~/auth/server'

const logger = createScopedLogger('instagram-oauth-callback')

const DEFAULT_REDIRECT = '/app/settings/channels'

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams
  const code = searchParams.get('code')
  const state = searchParams.get('state') // Base64 encoded
  const error = searchParams.get('error')
  const errorReason = searchParams.get('error_reason')
  const errorDescription = searchParams.get('error_description')

  let redirectPath = DEFAULT_REDIRECT
  let parsedState: any = null

  // --- Session Verification (CSRF protection) ---
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.redirect(
      new URL(`/login?callbackUrl=${encodeURIComponent(req.url)}`, req.url)
    )
  }

  // --- State Parameter Handling ---
  if (state) {
    try {
      const decodedStateString = Buffer.from(state, 'base64').toString('utf-8')
      parsedState = JSON.parse(decodedStateString)
      redirectPath = validateRedirectPath(parsedState.redirectPath, DEFAULT_REDIRECT)
    } catch (e: any) {
      logger.error('Failed to parse/validate state parameter in Instagram callback', {
        state,
        error: e.message,
      })
      return NextResponse.redirect(
        new URL(
          `${redirectPath}?error=invalid_state&error_description=${encodeURIComponent(e.message || 'Invalid state parameter.')}`,
          WEBAPP_URL
        )
      )
    }
  } else {
    logger.error('Missing state parameter in Instagram callback')
    return NextResponse.redirect(
      new URL(
        `${DEFAULT_REDIRECT}?error=missing_state&error_description=${encodeURIComponent('State parameter missing.')}`,
        WEBAPP_URL
      )
    )
  }

  // --- Verify user matches the one who initiated the flow ---
  if (session.user.id !== parsedState?.userId) {
    logger.error('User mismatch in Instagram OAuth callback', {
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
    logger.error('CSRF token mismatch in Instagram OAuth callback')
    return NextResponse.redirect(
      new URL(
        `${redirectPath}?error=csrf_mismatch&error_description=${encodeURIComponent('CSRF verification failed. Please try again.')}`,
        WEBAPP_URL
      )
    )
  }

  // --- Handle OAuth Errors ---
  if (error) {
    const errorMessage =
      errorDescription || errorReason || error || 'Unknown Instagram/Facebook OAuth error'
    logger.error('Instagram OAuth Error during callback:', {
      error,
      errorReason,
      errorDescription,
      state: parsedState,
    })
    return NextResponse.redirect(
      new URL(
        `${redirectPath}?error=${encodeURIComponent(error)}&error_reason=${encodeURIComponent(errorReason || '')}&error_description=${encodeURIComponent(errorMessage)}`,
        WEBAPP_URL
      )
    )
  }

  // --- Handle Missing Code ---
  if (!code) {
    logger.error('Missing authorization code in Instagram callback', { state: parsedState })
    return NextResponse.redirect(
      new URL(
        `${redirectPath}?error=missing_code&error_description=${encodeURIComponent('Authorization code not found.')}`,
        WEBAPP_URL
      )
    )
  }

  // --- Process Authorization Code ---
  try {
    const oauthService = InstagramOAuthService.getInstance()
    const result = await oauthService.handleCallback(code, state) // Pass original state

    // Extract identifier (Instagram Username) from metadata
    let identifier = 'Unknown Account'
    if (result.integration.metadata) {
      const metadata = result.integration
        .metadata as unknown as Partial<InstagramIntegrationMetadata>
      identifier = metadata.instagramUsername ?? identifier
    }

    logger.info('Instagram OAuth callback processed successfully', {
      integrationId: result.integration.id,
      identifier,
    })

    await publisher.publishLater({
      type: 'integration:connected',
      data: {
        organizationId: parsedState?.orgId,
        userId: parsedState?.userId,
        provider: 'instagram',
        identifier,
        integrationId: result.integration.id,
      },
    })

    return NextResponse.redirect(
      new URL(
        `${redirectPath}?success=true&provider=instagram&identifier=${encodeURIComponent(identifier)}&integrationId=${result.integration.id}`,
        WEBAPP_URL
      )
    )
  } catch (error: any) {
    logger.error('Error processing Instagram OAuth callback code:', {
      error: error.message,
      stack: error.stack,
      state: parsedState,
    })

    await publisher.publishLater({
      type: 'integration:connection_failed',
      data: {
        organizationId: parsedState?.orgId,
        userId: parsedState?.userId,
        provider: 'instagram',
        error: error.message || 'Failed to complete Instagram authorization.',
      },
    })

    return NextResponse.redirect(
      new URL(
        `${redirectPath}?error=oauth_callback_failed&error_description=${encodeURIComponent(error.message || 'Failed to complete Instagram authorization.')}`,
        WEBAPP_URL
      )
    )
  }
}
