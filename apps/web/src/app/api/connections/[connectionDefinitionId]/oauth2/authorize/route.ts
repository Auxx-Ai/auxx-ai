// apps/web/src/app/api/connections/[connectionDefinitionId]/oauth2/authorize/route.ts

import { WEBAPP_URL } from '@auxx/config/urls'
import type { OAuth2Features } from '@auxx/database'
import { database as db } from '@auxx/database'
import { supportsPersonalChannelConnection } from '@auxx/lib/channels'
import {
  providerOAuthCallbackUrl,
  resolveConnectionForRuntime,
  resolveOAuth2Client,
  resolveOwnClientGateForOrg,
  stripUnentitledOwnClientVars,
} from '@auxx/lib/connections'
import { createScopedLogger } from '@auxx/logger'
import { getRedisClient } from '@auxx/redis'
import { interpolateConnectionFields } from '@auxx/services/app-connections'
import crypto from 'crypto'
import { headers } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '~/auth/server'

const logger = createScopedLogger('connection-oauth-authorize')

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

    // Personal channel connect (mail-permissions §11.1): mints a USER-scoped
    // credential feeding a dedicated personal inbox. Only email-like channel
    // providers are eligible — enforced here, fail closed, independent of the
    // wizard UI.
    const personal = searchParams.get('personal') === '1'
    if (personal && !supportsPersonalChannelConnection(connDef.providerKey)) {
      return NextResponse.json(
        { error: 'This channel cannot be connected as a personal account' },
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

    // Approval gate (§3.1), org-aware: only a genuinely absent platform client
    // (`requiresOwnClient`, reason `no-platform-client`) forces BYO id/secret — enforce
    // that server-side, never trusting the dialog. A platform client pending verification
    // yields `requiresOwnClient: false` (BYO is optional), so the platform kickoff
    // proceeds here and Google shows its own unverified-app gating; BYO vars, when
    // supplied, still win in `resolveOAuth2Client`. A verified platform client offers BYO
    // only to orgs holding `byoOAuthClient`.
    const ownClient = await resolveOwnClientGateForOrg(organizationId, connDef)

    // Extract connection variables from query params (allowlisted by the definition)
    const rawVariables: Record<string, string> = {}
    for (const varDef of connDef.connectionVariables ?? []) {
      const value = searchParams.get(`var_${varDef.key}`) ?? storedVariables[varDef.key]
      if (!value && varDef.required !== false) {
        return NextResponse.json(
          { error: `Missing required variable: ${varDef.label}` },
          { status: 400 }
        )
      }
      if (value) rawVariables[varDef.key] = value
    }

    // The dialog hides the BYO fields when the gate offers no BYO path, but this route
    // takes them off the query string — drop caller-supplied client credentials so an org
    // cannot opt itself into another OAuth client by appending `var_clientId`.
    const connectionVariables = stripUnentitledOwnClientVars(
      rawVariables,
      ownClient,
      storedVariables
    )

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
        ...(personal && { personal: true }),
        ...(connectionId && { connectionId }),
        ...(codeVerifier && { codeVerifier }),
        ...(validReturnTo && { returnTo: validReturnTo }),
        ...(Object.keys(connectionVariables).length > 0 && { connectionVariables }),
        ...(Object.keys(postConnect).length > 0 && { postConnect }),
        mode,
        originOfOpener,
      })
    )

    const scopes = [...new Set([...(connDef.oauth2Scopes || []), ...scopeAdd])]

    // Pinned to the definition's providerKey, never `defParam`: the lookup above accepts
    // an id OR a providerKey, so echoing the raw param would make the redirect URI depend
    // on which spelling the caller used. A BYO user registers exactly one URI.
    const redirectUri = providerOAuthCallbackUrl(connDef, features.callbackBaseUrl)

    const authUrl = new URL(resolved.authorizeUrl)
    authUrl.searchParams.set('client_id', clientId)
    authUrl.searchParams.set('redirect_uri', redirectUri)
    authUrl.searchParams.set('scope', scopes.join(features.scopeSeparator || ' '))
    authUrl.searchParams.set('state', state)
    authUrl.searchParams.set('response_type', 'code')

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
