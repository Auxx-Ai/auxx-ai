// apps/web/src/app/api/connections/[connectionDefinitionId]/oauth2/authorize/route.ts

import { WEBAPP_URL } from '@auxx/config/urls'
import type { OAuth2Features } from '@auxx/database'
import { database as db } from '@auxx/database'
import {
  resolveConnectionForRuntime,
  resolveOAuth2Client,
  resolveOwnClientRequirement,
} from '@auxx/lib/connections'
import { createScopedLogger } from '@auxx/logger'
import { getRedisClient } from '@auxx/redis'
import { interpolateConnectionFields } from '@auxx/services/app-connections'
import crypto from 'crypto'
import { headers } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '~/auth/server'

const OAUTH_REDIRECT_BASE = process.env.NGROK_URL || WEBAPP_URL

const logger = createScopedLogger('connection-oauth-authorize')

/**
 * Google requires access_type=offline as a URL parameter (not a scope) to issue refresh tokens.
 * Every other provider configures its scopes directly on the ConnectionDefinition.
 */
function getGoogleOfflineParams(authUrl: string): Record<string, string> | undefined {
  if (authUrl.includes('accounts.google.com')) {
    return { access_type: 'offline', prompt: 'consent' }
  }
}

/**
 * Generalized OAuth Authorize Route — any owner (app / mcp / platform built-in).
 * GET /api/connections/:connectionDefinitionId/oauth2/authorize
 *
 * `:connectionDefinitionId` is resolved smartly: it matches either a ConnectionDefinition `id`
 * or a platform `providerKey` (e.g. `googleOAuth2Api`), so callers can link by either.
 *
 * Redirects the user to the provider's authorization page. The credential's scope (org-wide vs
 * per-user) follows the definition's `global` flag — the resolver queries by it.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ connectionDefinitionId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() })

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const organizationId = (session.user as any).defaultOrganizationId
  if (!organizationId) {
    return NextResponse.json({ error: 'No organization' }, { status: 401 })
  }

  const { connectionDefinitionId: defParam } = await params
  const searchParams = request.nextUrl.searchParams
  const connectionId = searchParams.get('connectionId') // reconnect mode
  const returnTo = searchParams.get('returnTo')
  const name = searchParams.get('name') // credential display name
  const mode = searchParams.get('mode') === 'popup' ? 'popup' : 'redirect'

  // Additive scopes for incremental grants (e.g. the calendar-readonly grant layered onto an
  // existing Gmail connection). Merged with the definition's scopes for this authorize only.
  const scopeAdd = searchParams
    .getAll('scope_add')
    .flatMap((s) => s.split(','))
    .map((s) => s.trim())
    .filter(Boolean)

  // Opaque post-connect context (`pc_*`) handed to the provider's post-connect hook via `extra`.
  const postConnect: Record<string, string> = {}
  for (const [key, value] of searchParams.entries()) {
    if (key.startsWith('pc_') && value) postConnect[key.slice(3)] = value
  }

  // Validate returnTo: must be a relative path, not protocol-relative
  const validReturnTo = returnTo?.startsWith('/') && !returnTo.startsWith('//') ? returnTo : null

  // Capture opener origin for popup-mode postMessage target — trust only headers.
  const reqHeaders = await headers()
  let originOfOpener: string = WEBAPP_URL
  const originHeader = reqHeaders.get('origin')
  const referer = reqHeaders.get('referer')
  if (originHeader) {
    originOfOpener = originHeader
  } else if (referer) {
    try {
      originOfOpener = new URL(referer).origin
    } catch {
      // keep WEBAPP_URL fallback
    }
  }

  try {
    // Smart resolution: the path segment is a definition id OR a platform providerKey.
    const connDef = await db.query.ConnectionDefinition.findFirst({
      where: (cd, { eq, or }) => or(eq(cd.id, defParam), eq(cd.providerKey, defParam)),
    })

    if (!connDef) {
      return NextResponse.json({ error: 'Connection definition not found' }, { status: 404 })
    }

    if (connDef.connectionType !== 'oauth2-code') {
      return NextResponse.json(
        { error: 'OAuth is not configured for this connection' },
        { status: 400 }
      )
    }

    // Generate CSRF state + optional PKCE verifier (RFC 7636)
    const state = crypto.randomBytes(32).toString('hex')
    const features = (connDef.oauth2Features ?? {}) as OAuth2Features
    let codeVerifier: string | undefined
    if (features.pkce) {
      codeVerifier = crypto.randomBytes(96).toString('base64url')
    }

    // On reconnect, reuse the variables saved with the existing connection (e.g. a Shopify shop)
    // so the user isn't re-prompted. Explicit query params still win.
    let storedVariables: Record<string, string> = {}
    if (connectionId && connDef.providerKey) {
      const resolved = await resolveConnectionForRuntime({
        providerKey: connDef.providerKey,
        organizationId,
        userId: session.user.id,
        connectionId,
        ensureFresh: false,
      })
      if (resolved.isOk()) {
        const conn = resolved.value.userConnection ?? resolved.value.organizationConnection
        if (conn?.fields) storedVariables = conn.fields
      }
    }

    // Extract connection variables from query params (allowlisted by the definition)
    const connectionVariables: Record<string, string> = {}
    for (const varDef of connDef.connectionVariables ?? []) {
      const value = searchParams.get(`var_${varDef.key}`) ?? storedVariables[varDef.key]
      if (!value && varDef.required !== false) {
        return NextResponse.json(
          { error: `Missing required variable: ${varDef.label}` },
          { status: 400 }
        )
      }
      if (value) connectionVariables[varDef.key] = value
    }

    // Approval gate (§3.1): when the platform client is unusable (absent or pending
    // verification), the connection MUST bring its own client id/secret. Enforce
    // server-side — the connect dialog already requires the fields, but never trust it.
    const ownClient = resolveOwnClientRequirement(connDef)
    if (
      ownClient.requiresOwnClient &&
      !(connectionVariables.clientId && connectionVariables.clientSecret)
    ) {
      return NextResponse.json(
        {
          error: 'This connection requires your own OAuth client id and secret',
          reason: ownClient.reason,
        },
        { status: 400 }
      )
    }

    // Interpolate the definition's OAuth fields with the variables. Client id/secret
    // follow the §3.2 precedence (per-credential vars win over the platform client).
    const resolved = interpolateConnectionFields(connDef, connectionVariables)
    const { clientId } = resolveOAuth2Client(connDef, connectionVariables)

    // Store state in Redis (10-minute TTL)
    const redis = await getRedisClient()
    await redis.setex(
      `oauth:connection:${state}`,
      600,
      JSON.stringify({
        userId: session.user.id,
        organizationId,
        connectionDefinitionId: connDef.id,
        providerKey: connDef.providerKey,
        connectionName: name || connDef.label || connDef.providerKey,
        global: connDef.global,
        ...(connectionId && { connectionId }),
        ...(codeVerifier && { codeVerifier }),
        ...(validReturnTo && { returnTo: validReturnTo }),
        ...(Object.keys(connectionVariables).length > 0 && { connectionVariables }),
        ...(Object.keys(postConnect).length > 0 && { postConnect }),
        mode,
        originOfOpener,
      })
    )

    const callbackBase = features.callbackBaseUrl || OAUTH_REDIRECT_BASE
    const scopes = [...new Set([...(connDef.oauth2Scopes || []), ...scopeAdd])]
    const googleParams = getGoogleOfflineParams(resolved.authorizeUrl)

    const authUrl = new URL(resolved.authorizeUrl)
    authUrl.searchParams.set('client_id', clientId)
    authUrl.searchParams.set(
      'redirect_uri',
      `${callbackBase}/api/connections/${defParam}/oauth2/callback`
    )
    authUrl.searchParams.set('scope', scopes.join(features.scopeSeparator || ' '))
    authUrl.searchParams.set('state', state)
    authUrl.searchParams.set('response_type', 'code')

    if (googleParams) {
      for (const [key, value] of Object.entries(googleParams)) {
        authUrl.searchParams.set(key, value)
      }
    }

    if (features.additionalAuthorizeParams) {
      for (const [key, value] of Object.entries(features.additionalAuthorizeParams)) {
        authUrl.searchParams.set(key, value)
      }
    }

    if (features.pkce && codeVerifier) {
      const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')
      authUrl.searchParams.set('code_challenge', codeChallenge)
      authUrl.searchParams.set('code_challenge_method', 'S256')
    }

    logger.info('Redirecting to OAuth provider', {
      connectionDefinitionId: connDef.id,
      providerKey: connDef.providerKey,
      global: connDef.global,
      scopes,
    })

    const response = NextResponse.redirect(authUrl.toString())

    // Short-lived returnTo cookie fallback (some providers drop state on error)
    if (validReturnTo) {
      response.cookies.set('oauth_return_to', validReturnTo, {
        maxAge: 600,
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
      defParam,
    })
    return NextResponse.json({ error: 'Failed to initiate OAuth' }, { status: 500 })
  }
}
