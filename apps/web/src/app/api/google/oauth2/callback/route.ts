// /api/google/oauth2/callback/route.ts

import { requireAdminAccess } from '@auxx/lib/email'
import { publisher } from '@auxx/lib/events'
import { GoogleOAuthService } from '@auxx/lib/providers'
import { createScopedLogger } from '@auxx/logger'
import { OAUTH_CSRF_COOKIE, validateRedirectPath } from '@auxx/utils'
import { cookies, headers } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '~/auth/server'

const logger = createScopedLogger('google-oauth-callback')

export async function GET(request: NextRequest) {
  const defaultRedirectPath = '/app/settings/channels/new/google/result' // Updated default path?

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

    // --- CSRF cookie verification ---
    const cookieStore = await cookies()
    const csrfCookie = cookieStore.get(OAUTH_CSRF_COOKIE)?.value
    if (!csrfCookie || csrfCookie !== state.csrfToken) {
      logger.error('CSRF token mismatch in Google OAuth callback')
      return NextResponse.redirect(
        new URL(`${defaultRedirectPath}?success=false&error=csrf_mismatch`, request.url)
      )
    }
    cookieStore.delete(OAUTH_CSRF_COOKIE)

    // Handle the OAuth2 callback
    const oauthService = GoogleOAuthService.getInstance()
    const result = await oauthService.handleCallback(code, stateString)

    await publisher.publishLater({
      type: 'integration:connected',
      data: {
        organizationId: state.orgId,
        userId: session.user.id,
        provider: 'google',
      },
    })

    // Redirect to the specified path or default (validated against open redirect)
    const redirectPath = validateRedirectPath(state.redirectPath, defaultRedirectPath)
    return NextResponse.redirect(new URL(`${redirectPath}?success=true`, request.url))
  } catch (error: any) {
    logger.error('OAuth callback error:', { error })

    await publisher.publishLater({
      type: 'integration:connection_failed',
      data: {
        organizationId: state?.orgId,
        userId: session?.user?.id,
        provider: 'google',
        error: error?.message || 'connection_failed',
      },
    })

    return NextResponse.redirect(
      new URL(`${defaultRedirectPath}?success=false&error=connection_failed`, request.url)
    )
  }
}
