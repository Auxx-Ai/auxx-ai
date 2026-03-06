// apps/web/src/app/api/apps/[slug]/oauth2/authorize/route.ts

import { WEBAPP_URL } from '@auxx/config/urls'
import type { OAuth2Features } from '@auxx/database'
import { database as db } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getRedisClient } from '@auxx/redis'
import { interpolateConnectionFields } from '@auxx/services/app-connections'
import crypto from 'crypto'

const OAUTH_REDIRECT_BASE = process.env.NGROK_URL || WEBAPP_URL

import { headers } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '~/auth/server'

const logger = createScopedLogger('oauth-authorize')

/**
 * Google requires access_type=offline as a URL parameter (not a scope) to issue refresh tokens.
 * All other providers should have their scopes configured directly in the ConnectionDefinition.
 */
function getGoogleOfflineParams(authUrl: string): Record<string, string> | undefined {
  if (authUrl.includes('accounts.google.com')) {
    return { access_type: 'offline', prompt: 'consent' }
  }
}

/**
 * OAuth Authorize Route
 * GET /api/apps/:slug/oauth2/authorize?installation=:installationId&type=user|organization
 *
 * Redirects user to OAuth provider's authorization page
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() })

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const organizationId = (session.user as any).defaultOrganizationId
  if (!organizationId) {
    return NextResponse.json({ error: 'No organization' }, { status: 401 })
  }

  const { slug } = await params
  const searchParams = request.nextUrl.searchParams
  const installationId = searchParams.get('installation')
  const connectionType = searchParams.get('type') // 'user' or 'organization'
  const connectionId = searchParams.get('connectionId') // reconnect mode
  const returnTo = searchParams.get('returnTo')

  // Validate returnTo: must be relative path starting with /, not protocol-relative
  const validReturnTo = returnTo?.startsWith('/') && !returnTo.startsWith('//') ? returnTo : null

  if (!installationId || !connectionType) {
    return NextResponse.json(
      { error: 'Missing required parameters: installation and type' },
      { status: 400 }
    )
  }

  const isGlobal = connectionType === 'organization'

  try {
    // Get app by slug first
    const app = await db.query.App.findFirst({
      where: (a, { eq }) => eq(a.slug, slug),
      columns: { id: true, slug: true },
    })

    if (!app) {
      return NextResponse.json({ error: 'App not found' }, { status: 404 })
    }

    const appId = app.id

    // Get installation to verify it exists and belongs to org
    const installation = await db.query.AppInstallation.findFirst({
      where: (inst, { eq, and }) =>
        and(
          eq(inst.id, installationId),
          eq(inst.appId, appId),
          eq(inst.organizationId, organizationId)
        ),
      with: {
        app: {
          columns: {
            title: true,
          },
        },
      },
    })

    if (!installation) {
      return NextResponse.json({ error: 'Installation not found' }, { status: 404 })
    }

    // Get connection definition (simplified — no version major needed)
    const connDef = await db.query.ConnectionDefinition.findFirst({
      where: (cd, { eq, and }) => and(eq(cd.appId, appId), eq(cd.global, isGlobal)),
    })

    if (!connDef || connDef.connectionType !== 'oauth2-code') {
      return NextResponse.json(
        { error: 'OAuth not configured for this app connection' },
        { status: 400 }
      )
    }

    // Generate state token for CSRF protection
    const state = crypto.randomBytes(32).toString('hex')

    // PKCE support (RFC 7636)
    const features = (connDef.oauth2Features ?? {}) as OAuth2Features
    let codeVerifier: string | undefined

    if (features.pkce) {
      codeVerifier = crypto.randomBytes(96).toString('base64url')
    }

    // Extract connection variables from query params (allowlisted by definitions)
    const connectionVariables: Record<string, string> = {}
    const connectionVarDefs = features.connectionVariables ?? []
    for (const varDef of connectionVarDefs) {
      const value = searchParams.get(`var_${varDef.key}`)
      if (!value && varDef.required !== false) {
        return NextResponse.json(
          { error: `Missing required variable: ${varDef.label}` },
          { status: 400 }
        )
      }
      if (value) connectionVariables[varDef.key] = value
    }

    // Interpolate all connection fields with variables
    const resolved = interpolateConnectionFields(connDef, connectionVariables)

    // Store state in Redis with metadata (expires in 10 minutes)
    const redis = await getRedisClient()
    await redis.setex(
      `oauth:app-connection:${state}`,
      600,
      JSON.stringify({
        userId: session.user.id,
        organizationId,
        appId,
        installationId,
        appTitle: installation.app!.title,
        connectionDefinitionId: connDef.id,
        global: connDef.global,
        ...(connectionId && { connectionId }),
        ...(codeVerifier && { codeVerifier }),
        ...(validReturnTo && { returnTo: validReturnTo }),
        ...(Object.keys(connectionVariables).length > 0 && { connectionVariables }),
      })
    )

    // Resolve callback base URL (per-connection override or global default)
    const callbackBase = features.callbackBaseUrl || OAUTH_REDIRECT_BASE

    const scopes = connDef.oauth2Scopes || []
    const googleParams = getGoogleOfflineParams(resolved.authorizeUrl)

    // Build OAuth authorization URL
    const authUrl = new URL(resolved.authorizeUrl)
    authUrl.searchParams.set('client_id', resolved.clientId)
    authUrl.searchParams.set('redirect_uri', `${callbackBase}/api/apps/${slug}/oauth2/callback`)
    const scopeSeparator = features.scopeSeparator || ' '
    authUrl.searchParams.set('scope', scopes.join(scopeSeparator))
    authUrl.searchParams.set('state', state)
    authUrl.searchParams.set('response_type', 'code')

    // Google requires access_type=offline as a URL parameter for refresh tokens
    if (googleParams) {
      for (const [key, value] of Object.entries(googleParams)) {
        authUrl.searchParams.set(key, value)
      }
    }

    // Append additional authorize params from connection definition
    if (features.additionalAuthorizeParams) {
      for (const [key, value] of Object.entries(features.additionalAuthorizeParams)) {
        authUrl.searchParams.set(key, value)
      }
    }

    // Append PKCE code_challenge to authorize URL
    if (features.pkce && codeVerifier) {
      const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')

      authUrl.searchParams.set('code_challenge', codeChallenge)
      authUrl.searchParams.set('code_challenge_method', 'S256')
    }

    logger.info('Redirecting to OAuth provider', {
      appId,
      slug,
      installationId,
      global: isGlobal,
      provider: connDef.oauth2AuthorizeUrl,
      scopes,
    })

    // Redirect to OAuth provider
    const response = NextResponse.redirect(authUrl.toString())

    // Set short-lived cookie as fallback for returnTo (some providers don't include state on error)
    if (validReturnTo) {
      response.cookies.set('oauth_return_to', validReturnTo, {
        maxAge: 600, // 10 min, same as Redis TTL
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
      })
    }

    return response
  } catch (error) {
    logger.error('OAuth authorize failed', {
      error: error instanceof Error ? error.message : String(error),
      slug,
      installationId,
    })
    return NextResponse.json({ error: 'Failed to initiate OAuth' }, { status: 500 })
  }
}
