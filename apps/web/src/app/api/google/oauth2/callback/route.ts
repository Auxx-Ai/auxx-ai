// /api/google/oauth2/callback/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { GoogleOAuthService } from '@auxx/lib/providers'
import { auth } from '~/auth/server'
import { createScopedLogger } from '@auxx/logger'
import { requireAdminAccess } from '@auxx/lib/email'
import { headers } from 'next/headers'

const logger = createScopedLogger('google-oauth-callback')

export async function GET(request: NextRequest) {
  const defaultRedirectPath = '/app/settings/integrations/new/google/result' // Updated default path?

  try {
    // const session = await auth()
    const session = await auth.api.getSession({ headers: await headers() })

    if (!session || !session.user) {
      return NextResponse.redirect(
        new URL(`/login?callbackUrl=${encodeURIComponent(request.url)}`, request.url)
      )
    }

    // Extract URL search params
    const searchParams = request.nextUrl.searchParams
    const code = searchParams.get('code')
    const stateString = searchParams.get('state')
    const error = searchParams.get('error')

    // Handle OAuth errors
    if (error) {
      logger.error('OAuth error:', { error })
      return NextResponse.redirect(
        new URL(
          `${defaultRedirectPath}?success=false&error=${encodeURIComponent(error)}`,
          request.url
        )
      )
    }

    // Validate required parameters
    if (!code || !stateString) {
      logger.error('Missing required parameters')
      return NextResponse.redirect(
        new URL(`${defaultRedirectPath}?success=false&error=missing_parameters`, request.url)
      )
    }

    // Parse state
    let state
    try {
      state = JSON.parse(stateString)
    } catch (e) {
      logger.error('Invalid state parameter:', { error: e })
      return NextResponse.redirect(
        new URL(`${defaultRedirectPath}?success=false&error=invalid_state`, request.url)
      )
    }

    // Verify user is authenticated and is the same one who initiated the flow
    if (session.user.id !== state.userId) {
      logger.error('User authentication failed or mismatch')
      return NextResponse.redirect(
        new URL(`/login?callbackUrl=${encodeURIComponent(request.url)}`, request.url)
      )
    }

    // Verify user has admin role for the organization
    try {
      await requireAdminAccess(session.user.id, state.orgId)
    } catch (error) {
      logger.error('User is not an admin:', { error })
      return NextResponse.redirect(
        new URL(`${defaultRedirectPath}?success=false&error=insufficient_permissions`, request.url)
      )
    }

    // Handle the OAuth2 callback
    const oauthService = GoogleOAuthService.getInstance()
    const result = await oauthService.handleCallback(code, stateString)

    // Redirect to the specified path or default
    const redirectPath = state.redirectPath || '/app/settings/integrations/new/google/result'
    return NextResponse.redirect(new URL(`${redirectPath}?success=true`, request.url))
  } catch (error) {
    logger.error('OAuth callback error:', { error })
    return NextResponse.redirect(
      new URL(`${defaultRedirectPath}?success=false&error=connection_failed`, request.url)
    )
  }
}
