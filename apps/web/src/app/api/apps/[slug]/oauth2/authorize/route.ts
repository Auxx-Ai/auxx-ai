// apps/web/src/app/api/apps/[slug]/oauth2/authorize/route.ts

import { WEBAPP_URL } from '@auxx/config/urls'
import type { OAuth2Features } from '@auxx/database'
import { database as db } from '@auxx/database'
import { resolveAppConnectionForRuntime } from '@auxx/lib/apps'
import { resolveAppSlug } from '@auxx/lib/cache'
import { resolveOAuth2Client, resolveOwnClientRequirement } from '@auxx/lib/connections'
import { AuxxError } from '@auxx/lib/errors'
import { PermissionKey, requirePermission } from '@auxx/lib/permissions'
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
  const connectionDefinitionId = searchParams.get('connectionDefinitionId') // picked method (multi-method)
  const connectionId = searchParams.get('connectionId') // reconnect mode
  const returnTo = searchParams.get('returnTo')
  const mode = searchParams.get('mode') === 'popup' ? 'popup' : 'redirect'

  // Validate returnTo: must be relative path starting with /, not protocol-relative
  const validReturnTo = returnTo?.startsWith('/') && !returnTo.startsWith('//') ? returnTo : null

  // Capture opener origin for popup-mode postMessage target.
  // Trust only Origin/Referer headers, never client-controlled params.
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

  if (!installationId || !connectionType) {
    return NextResponse.json(
      { error: 'Missing required parameters: installation and type' },
      { status: 400 }
    )
  }

  const isGlobal = connectionType === 'organization'

  try {
    // Resolve app slug from cache
    const appId = await resolveAppSlug(slug)

    if (!appId) {
      return NextResponse.json({ error: 'App not found' }, { status: 404 })
    }

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

    // Get connection definition. With a picked method (multi-method app), look it up by id and
    // let it own the scope; otherwise fall back to the single-method (appId, scope) lookup.
    const connDef = connectionDefinitionId
      ? await db.query.ConnectionDefinition.findFirst({
          where: (cd, { eq, and }) => and(eq(cd.id, connectionDefinitionId), eq(cd.appId, appId)),
        })
      : await db.query.ConnectionDefinition.findFirst({
          where: (cd, { eq, and }) => and(eq(cd.appId, appId), eq(cd.global, isGlobal)),
        })

    if (!connDef || connDef.connectionType !== 'oauth2-code') {
      return NextResponse.json(
        { error: 'OAuth not configured for this app connection' },
        { status: 400 }
      )
    }

    // Scope is a property of the method, exactly as in `apps.saveSecretConnection`: with a picked
    // method the def owns the scope, otherwise the `type` param does (the fallback lookup above
    // already constrains `cd.global` to it). This is the same value stashed as `global` in the
    // Redis state below, which the callback turns into the credential's `userId` column —
    // `null` (org-wide) when org-scoped.
    //
    // Org-scoped connections gate on the integrations key; user-scoped ones
    // belong to the caller (plan 21 §4.1).
    const isOrgScoped = connectionDefinitionId ? connDef.global === true : isGlobal
    if (isOrgScoped) {
      try {
        await requirePermission(session.user.id, organizationId, PermissionKey.integrationsManage)
      } catch (permissionError) {
        // Returned explicitly so the AuxxError keeps its own 403 instead of being flattened
        // into the outer catch's generic 500.
        if (permissionError instanceof AuxxError) {
          return NextResponse.json(
            { error: permissionError.message },
            { status: permissionError.statusCode }
          )
        }
        throw permissionError
      }
    }

    // Generate state token for CSRF protection
    const state = crypto.randomBytes(32).toString('hex')

    // PKCE support (RFC 7636)
    const features = (connDef.oauth2Features ?? {}) as OAuth2Features
    let codeVerifier: string | undefined

    if (features.pkce) {
      codeVerifier = crypto.randomBytes(96).toString('base64url')
    }

    // On reconnect, reuse the variables saved with the existing connection (e.g. the
    // Shopify shop) so the user isn't asked for them again. Explicit query params still win.
    // `fields` is the merged map (plain metadata variables + decrypted secret-flagged ones).
    let storedVariables: Record<string, string> = {}
    if (connectionId) {
      const resolved = await resolveAppConnectionForRuntime({
        appId,
        organizationId,
        userId: session.user.id,
        connectionId,
        // Reconnect only reads the stored connection variables — skip the OAuth refresh.
        ensureFresh: false,
      })
      if (resolved.isOk()) {
        const conn = resolved.value.userConnection ?? resolved.value.organizationConnection
        if (conn?.fields) storedVariables = conn.fields
      }
    }

    // Extract connection variables from query params (allowlisted by definitions)
    const connectionVariables: Record<string, string> = {}
    const connectionVarDefs = connDef.connectionVariables ?? []
    for (const varDef of connectionVarDefs) {
      const value = searchParams.get(`var_${varDef.key}`) ?? storedVariables[varDef.key]
      if (!value && varDef.required !== false) {
        return NextResponse.json(
          { error: `Missing required variable: ${varDef.label}` },
          { status: 400 }
        )
      }
      if (value) connectionVariables[varDef.key] = value
    }

    // Own-client gate (§3.1): only a genuinely absent platform client forces BYO id/secret.
    // A platform client pending verification is optional-BYO — the platform kickoff proceeds
    // and the provider (e.g. Google) applies its own unverified-app gating.
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

    // Interpolate all connection fields with variables (for authorize URL + non-client fields).
    const resolved = interpolateConnectionFields(connDef, connectionVariables)
    // Client id follows §3.2 precedence: a per-connection BYO `clientId` var wins over the
    // app's platform client. Same resolver the provider authorize route + token refresh use.
    const { clientId: resolvedClientId } = resolveOAuth2Client(connDef, connectionVariables)

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
        mode,
        originOfOpener,
      })
    )

    // Resolve callback base URL (per-connection override or global default)
    const callbackBase = features.callbackBaseUrl || OAUTH_REDIRECT_BASE

    const scopes = connDef.oauth2Scopes || []
    const googleParams = getGoogleOfflineParams(resolved.authorizeUrl)

    // Build OAuth authorization URL
    const authUrl = new URL(resolved.authorizeUrl)
    authUrl.searchParams.set('client_id', resolvedClientId)
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
