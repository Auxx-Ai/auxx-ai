// app/api/outlook/oauth2/callback/route.ts

import { WEBAPP_URL } from '@auxx/config/server'
import { publisher } from '@auxx/lib/events'
import { OutlookOAuthService } from '@auxx/lib/providers'
import { createScopedLogger } from '@auxx/logger'
import type { NextRequest } from 'next/server'

const logger = createScopedLogger('outlook-oauth-callback')

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')
  const errorDescription = searchParams.get('error_description') // Capture error description

  // Default redirect path
  let redirectPath = '/app/settings/integrations/new/outlook/result' // Updated default path?

  try {
    if (state) {
      const parsedState = JSON.parse(state) // State should contain orgId, userId, and optionally redirectPath
      if (parsedState.redirectPath) {
        redirectPath = parsedState.redirectPath
      }
    }
  } catch (e) {
    logger.error('Failed to parse state parameter in Outlook callback', { state, error: e })
    // Redirect with a generic state error, as we don't know the intended redirect path
    return Response.redirect(
      `${WEBAPP_URL}${redirectPath}?error=invalid_state&error_description=${encodeURIComponent('Invalid state parameter received.')}`
    )
  }

  // Handle OAuth errors or missing code
  if (error || !code || !state) {
    const errorMessage = errorDescription || error || 'missing_code'
    logger.warn('OAuth error or missing code in Outlook callback', {
      error,
      errorDescription,
      state,
    })
    return Response.redirect(
      `${WEBAPP_URL}${redirectPath}?error=${encodeURIComponent(error || 'oauth_error')}&error_description=${encodeURIComponent(errorMessage)}`
    )
  }

  try {
    // Process the OAuth callback using the service
    const oauthService = OutlookOAuthService.getInstance()
    // handleCallback now returns the integration object which includes metadata
    const result = await oauthService.handleCallback(code, state)

    // Extract identifier (email) from metadata for the redirect URL (optional)
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

    // Redirect to success page (e.g., integrations settings)
    return Response.redirect(
      `${WEBAPP_URL}${redirectPath}?success=true&identifier=${encodeURIComponent(identifier)}&integrationId=${result.integration.id}` // Pass back identifier and integration ID
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

    // Redirect with error information
    return Response.redirect(
      `${WEBAPP_URL}${redirectPath}?error=oauth_failed&error_description=${encodeURIComponent(error.message || 'Failed to complete Microsoft authorization')}`
    )
  }
}
