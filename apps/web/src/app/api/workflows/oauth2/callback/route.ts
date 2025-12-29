// apps/web/src/app/api/workflows/oauth2/callback/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { OAuth2WorkflowService } from '@auxx/lib/workflows'
import { createScopedLogger } from '@auxx/logger'
import { WEBAPP_URL } from '@auxx/config/server'

const logger = createScopedLogger('oauth2-callback')

/**
 * Handle OAuth2 callback from providers
 * This endpoint processes the authorization code and exchanges it for tokens
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')
  const errorDescription = searchParams.get('error_description')

  logger.info('OAuth2 callback received', {
    hasCode: !!code,
    hasState: !!state,
    error,
    errorDescription,
  })

  // Handle OAuth errors
  if (error) {
    logger.error('OAuth2 provider returned error', {
      error,
      errorDescription,
    })

    const errorUrl = new URL('/app/workflows/credentials', WEBAPP_URL)
    errorUrl.searchParams.set('oauth_error', error)
    errorUrl.searchParams.set('oauth_error_description', errorDescription || 'Unknown error')

    return NextResponse.redirect(errorUrl)
  }

  // Validate required parameters
  if (!code || !state) {
    logger.error('Missing required OAuth2 parameters', {
      hasCode: !!code,
      hasState: !!state,
    })

    const errorUrl = new URL('/app/workflows/credentials', WEBAPP_URL)
    errorUrl.searchParams.set('oauth_error', 'invalid_request')
    errorUrl.searchParams.set('oauth_error_description', 'Missing required parameters')

    return NextResponse.redirect(errorUrl)
  }

  try {
    // Process the OAuth callback
    const oauth2Service = OAuth2WorkflowService.getInstance()
    const result = await oauth2Service.handleCallback(code, state)

    if (result.success && result.credentialId) {
      logger.info('OAuth2 callback processed successfully', {
        credentialId: result.credentialId,
        userEmail: result.userInfo?.email,
      })

      // Redirect to credentials page with success message
      const successUrl = new URL('/app/workflows/credentials', WEBAPP_URL)
      successUrl.searchParams.set('oauth_success', 'true')
      successUrl.searchParams.set('credential_id', result.credentialId)
      if (result.userInfo?.email) {
        successUrl.searchParams.set('user_email', result.userInfo.email)
      }

      return NextResponse.redirect(successUrl)
    } else {
      logger.error('OAuth2 callback failed', {
        error: result.error,
      })

      // Redirect to credentials page with error
      const errorUrl = new URL('/app/workflows/credentials', WEBAPP_URL)
      errorUrl.searchParams.set('oauth_error', 'callback_failed')
      errorUrl.searchParams.set(
        'oauth_error_description',
        result.error || 'Callback processing failed'
      )

      return NextResponse.redirect(errorUrl)
    }
  } catch (error) {
    logger.error('OAuth2 callback processing failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    })

    // Redirect to credentials page with error
    const errorUrl = new URL('/app/workflows/credentials', WEBAPP_URL)
    errorUrl.searchParams.set('oauth_error', 'processing_failed')
    errorUrl.searchParams.set(
      'oauth_error_description',
      error instanceof Error ? error.message : 'An unexpected error occurred'
    )

    return NextResponse.redirect(errorUrl)
  }
}

/**
 * Handle POST requests (some OAuth providers might use POST for callbacks)
 */
export async function POST(request: NextRequest) {
  logger.info('OAuth2 POST callback received')

  try {
    const body = await request.json()
    const { code, state, error, error_description } = body

    // Handle OAuth errors
    if (error) {
      logger.error('OAuth2 provider returned error via POST', {
        error,
        error_description,
      })

      return NextResponse.json(
        {
          success: false,
          error,
          error_description,
        },
        { status: 400 }
      )
    }

    // Validate required parameters
    if (!code || !state) {
      logger.error('Missing required OAuth2 parameters in POST', {
        hasCode: !!code,
        hasState: !!state,
      })

      return NextResponse.json(
        {
          success: false,
          error: 'invalid_request',
          error_description: 'Missing required parameters',
        },
        { status: 400 }
      )
    }

    // Process the OAuth callback
    const oauth2Service = OAuth2WorkflowService.getInstance()
    const result = await oauth2Service.handleCallback(code, state)

    if (result.success) {
      logger.info('OAuth2 POST callback processed successfully', {
        credentialId: result.credentialId,
        userEmail: result.userInfo?.email,
      })

      return NextResponse.json({
        success: true,
        credentialId: result.credentialId,
        userInfo: result.userInfo,
      })
    } else {
      logger.error('OAuth2 POST callback failed', {
        error: result.error,
      })

      return NextResponse.json(
        {
          success: false,
          error: 'callback_failed',
          error_description: result.error || 'Callback processing failed',
        },
        { status: 400 }
      )
    }
  } catch (error) {
    logger.error('OAuth2 POST callback processing failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    })

    return NextResponse.json(
      {
        success: false,
        error: 'processing_failed',
        error_description: error instanceof Error ? error.message : 'An unexpected error occurred',
      },
      { status: 500 }
    )
  }
}
