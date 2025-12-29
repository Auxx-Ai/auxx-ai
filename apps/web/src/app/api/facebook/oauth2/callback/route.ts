// src/app/api/facebook/oauth2/callback/route.ts

import { type NextRequest } from 'next/server'
import { env, WEBAPP_URL } from '@auxx/config/server'
import { FacebookOAuthService } from '@auxx/lib/providers'
import type { FacebookIntegrationMetadata } from '@auxx/lib/providers'
import { createScopedLogger } from '@auxx/logger'

const logger = createScopedLogger('facebook-oauth-callback')

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams
  const code = searchParams.get('code')
  const state = searchParams.get('state') // This is base64 encoded
  const error = searchParams.get('error')
  const errorReason = searchParams.get('error_reason')
  const errorDescription = searchParams.get('error_description')
  // const defaultRedirectPath =  // Updated default path?

  // Default redirect path if state parsing fails or doesn't contain one
  let redirectPath = '/app/settings/integrations/new/facebook/result' // Sensible default
  let parsedState: any = null

  // --- State Parameter Handling ---
  if (state) {
    try {
      const decodedStateString = Buffer.from(state, 'base64').toString('utf-8')
      parsedState = JSON.parse(decodedStateString)
      if (parsedState.redirectPath) {
        redirectPath = parsedState.redirectPath
      }
      // TODO: Verify parsedState.csrfToken against a value stored in the user's session/cookie
      // if (!verifyCsrfToken(parsedState.csrfToken, req.cookies.get('fb_csrf'))) {
      //     throw new Error("CSRF token mismatch");
      // }
    } catch (e: any) {
      logger.error('Failed to parse or validate state parameter in Facebook callback', {
        state,
        error: e.message,
      })
      // Redirect with a specific state error

      return Response.redirect(
        new URL(
          `${redirectPath}?success=false&error=invalid_state&error_description=${encodeURIComponent(e.message || 'Invalid state parameter received.')}`,
          WEBAPP_URL
        )
      )
    }
  } else {
    logger.error('Missing state parameter in Facebook callback')
    // Cannot determine original redirect path without state
    return Response.redirect(
      new URL(
        `${redirectPath}?success=false&error=missing_state&error_description=${encodeURIComponent('State parameter is missing.')}`,
        WEBAPP_URL
      )
    )
  }

  // --- Handle OAuth Errors from Facebook ---
  if (error) {
    const errorMessage = errorDescription || errorReason || error || 'Unknown Facebook OAuth error'
    logger.error('Facebook OAuth Error during callback:', {
      error,
      errorReason,
      errorDescription,
      state: parsedState,
    })
    return Response.redirect(
      new URL(
        `${redirectPath}?success=false&error=${encodeURIComponent(error)}&error_description=${encodeURIComponent(errorMessage)}`,
        WEBAPP_URL
      )
    )
  }

  // --- Handle Missing Code ---
  if (!code) {
    logger.error('Missing authorization code in Facebook callback', { state: parsedState })
    return Response.redirect(
      new URL(
        `${redirectPath}?success=false&error=missing_code&error_description=${encodeURIComponent('Authorization code not found in callback.')}`,
        WEBAPP_URL
      )
    )
  }

  // --- Process the Authorization Code ---
  try {
    const oauthService = FacebookOAuthService.getInstance()
    // Pass the original base64 state string to handleCallback if needed for verification inside
    const result = await oauthService.handleCallback(code, state)

    // Extract identifier (Page Name) from metadata for the redirect URL
    let identifier = 'Unknown Page' // Default
    if (result.integration.metadata) {
      const metadata = result.integration
        .metadata as unknown as Partial<FacebookIntegrationMetadata>
      identifier = metadata.pageName ?? identifier
    }

    logger.info('Facebook OAuth callback processed successfully', {
      integrationId: result.integration.id,
      identifier,
    })

    // Redirect to success page (e.g., integrations settings)
    return Response.redirect(
      new URL(
        `${redirectPath}?success=true&provider=facebook&identifier=${encodeURIComponent(identifier)}&integrationId=${result.integration.id}`,
        WEBAPP_URL
      )
    )
  } catch (error: any) {
    logger.error('Error processing Facebook OAuth callback code:', {
      error: error.message,
      stack: error.stack,
      state: parsedState,
    })
    // Redirect with error information
    return Response.redirect(
      new URL(
        `${redirectPath}?success=false&error=oauth_callback_failed&error_description=${encodeURIComponent(error.message || 'Failed to complete Facebook authorization process.')}`,
        WEBAPP_URL
      )
    )
  }
}
