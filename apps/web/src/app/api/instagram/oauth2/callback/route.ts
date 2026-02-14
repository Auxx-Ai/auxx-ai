// src/app/api/instagram/oauth2/callback/route.ts

import { env, WEBAPP_URL } from '@auxx/config/server'
import type { InstagramIntegrationMetadata } from '@auxx/lib/providers'
import { InstagramOAuthService } from '@auxx/lib/providers'
import { createScopedLogger } from '@auxx/logger'
import type { NextRequest } from 'next/server'

const logger = createScopedLogger('instagram-oauth-callback')

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams
  const code = searchParams.get('code')
  const state = searchParams.get('state') // Base64 encoded
  const error = searchParams.get('error')
  const errorReason = searchParams.get('error_reason')
  const errorDescription = searchParams.get('error_description')

  let redirectPath = '/app/settings/integrations' // Default redirect
  let parsedState: any = null

  // --- State Parameter Handling & CSRF Check ---
  if (state) {
    try {
      const decodedStateString = Buffer.from(state, 'base64').toString('utf-8')
      parsedState = JSON.parse(decodedStateString)
      if (parsedState.redirectPath) {
        redirectPath = parsedState.redirectPath
      }
      // TODO: Verify CSRF token (parsedState.csrfToken)
    } catch (e: any) {
      logger.error('Failed to parse/validate state parameter in Instagram callback', {
        state,
        error: e.message,
      })
      return Response.redirect(
        `${WEBAPP_URL}${redirectPath}?error=invalid_state&error_description=${encodeURIComponent(e.message || 'Invalid state parameter.')}`
      )
    }
  } else {
    logger.error('Missing state parameter in Instagram callback')
    return Response.redirect(
      `${WEBAPP_URL}/app/settings/integrations?error=missing_state&error_description=${encodeURIComponent('State parameter missing.')}`
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
    return Response.redirect(
      `${WEBAPP_URL}${redirectPath}?error=${encodeURIComponent(error)}&error_reason=${encodeURIComponent(errorReason || '')}&error_description=${encodeURIComponent(errorMessage)}`
    )
  }

  // --- Handle Missing Code ---
  if (!code) {
    logger.error('Missing authorization code in Instagram callback', { state: parsedState })
    return Response.redirect(
      `${WEBAPP_URL}${redirectPath}?error=missing_code&error_description=${encodeURIComponent('Authorization code not found.')}`
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

    return Response.redirect(
      `${WEBAPP_URL}${redirectPath}?success=true&provider=instagram&identifier=${encodeURIComponent(identifier)}&integrationId=${result.integration.id}`
    )
  } catch (error: any) {
    logger.error('Error processing Instagram OAuth callback code:', {
      error: error.message,
      stack: error.stack,
      state: parsedState,
    })
    return Response.redirect(
      `${WEBAPP_URL}${redirectPath}?error=oauth_callback_failed&error_description=${encodeURIComponent(error.message || 'Failed to complete Instagram authorization.')}`
    )
  }
}
