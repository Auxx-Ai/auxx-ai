// apps/web/src/app/api/apps/[slug]/oauth2/callback/route.ts

import { WEBAPP_URL } from '@auxx/config/urls'
import { database as db } from '@auxx/database'
import { saveAppConnection } from '@auxx/lib/apps'
import { resolveAppSlug } from '@auxx/lib/cache'
import { resolveOAuth2Client } from '@auxx/lib/connections'
import { createScopedLogger } from '@auxx/logger'
import { getRedisClient } from '@auxx/redis'
import { interpolateConnectionFields } from '@auxx/services/app-connections'

const OAUTH_REDIRECT_BASE = process.env.NGROK_URL || WEBAPP_URL

import { type NextRequest, NextResponse } from 'next/server'

const logger = createScopedLogger('oauth-callback')

/** Build a redirect URL safely using URL/URLSearchParams */
function buildRedirectUrl(basePath: string, params: Record<string, string>): string {
  const url = new URL(basePath, WEBAPP_URL)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  return url.toString()
}

/** Validate a returnTo value — must be a relative path, not protocol-relative */
function isValidReturnTo(value: string | undefined | null): value is string {
  return !!value && value.startsWith('/') && !value.startsWith('//')
}

/**
 * Render the popup-mode termination page. Posts a payload to the parent via
 * postMessage (targeted at the stored opener origin) AND BroadcastChannel,
 * then closes itself. Values are JSON-stringified so they cannot break out
 * of the script context.
 */
function renderPopupTerminationPage(payload: {
  ok: boolean
  credId?: string | null
  appId?: string | null
  error?: string | null
  matchedExisting?: boolean
  originOfOpener: string
}): NextResponse {
  const message = {
    type: 'oauth_done',
    ok: payload.ok,
    credId: payload.credId ?? null,
    appId: payload.appId ?? null,
    error: payload.error ?? null,
    matchedExisting: payload.matchedExisting ?? false,
  }
  const serializedMessage = JSON.stringify(message).replace(/</g, '\\u003c')
  const serializedOrigin = JSON.stringify(payload.originOfOpener).replace(/</g, '\\u003c')
  const heading = payload.ok ? 'Connected' : 'Connection failed'
  const body = payload.ok
    ? 'You can close this window.'
    : `Something went wrong: ${payload.error ?? 'Unknown error'}. You can close this window.`

  const html = `<!doctype html>
<html>
  <head><title>${heading}</title></head>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 2rem; text-align: center;">
    <h1>${heading}</h1>
    <p>${body}</p>
    <script>
      (function () {
        var payload = ${serializedMessage};
        var origin = ${serializedOrigin};
        try { if (window.opener) { window.opener.postMessage(payload, origin); } } catch (_) {}
        try {
          var bc = new BroadcastChannel('oauth-app-connect');
          bc.postMessage(payload);
          bc.close();
        } catch (_) {}
        try { window.close(); } catch (_) {}
      })();
    </script>
  </body>
</html>`

  return new NextResponse(html, {
    status: payload.ok ? 200 : 400,
    headers: { 'Content-Type': 'text/html' },
  })
}

/**
 * OAuth Callback Route
 * GET /api/apps/:slug/oauth2/callback
 *
 * Handles OAuth provider callback, exchanges code for tokens, saves connection
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const searchParams = request.nextUrl.searchParams
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')
  const { slug } = await params

  // Peek at stored state metadata up-front so every termination branch
  // (provider error, success, callback error) can decide whether to render
  // the popup HTML page vs. a redirect. The state token is deleted in the
  // success path of the main try block below.
  let metadata: any = null
  if (state) {
    try {
      const redis = await getRedisClient()
      if (redis) {
        const stateData = await redis.get(`oauth:app-connection:${state}`)
        if (stateData) metadata = JSON.parse(stateData)
      }
    } catch {
      // ignore — fall through to normal validation below
    }
  }
  const isPopup = metadata?.mode === 'popup'
  const originOfOpener: string = metadata?.originOfOpener || WEBAPP_URL

  // Handle OAuth errors (provider-side, e.g. user denied)
  if (error) {
    logger.error('OAuth provider returned error', { error, slug })

    if (isPopup) {
      // Best-effort delete the state token now that we've consumed it.
      if (state) {
        try {
          const redis = await getRedisClient()
          await redis?.del(`oauth:app-connection:${state}`)
        } catch {}
      }
      return renderPopupTerminationPage({
        ok: false,
        appId: metadata?.appId ?? null,
        error,
        originOfOpener,
      })
    }

    // Check cookie fallback for returnTo (state may not be available on provider errors)
    const cookieReturnTo = request.cookies.get('oauth_return_to')?.value
    if (isValidReturnTo(cookieReturnTo)) {
      const errorRedirectUrl = buildRedirectUrl(cookieReturnTo, {
        oauth_error: 'true',
        oauth_error_message: error,
      })
      const response = NextResponse.redirect(errorRedirectUrl)
      response.cookies.delete('oauth_return_to')
      return response
    }

    return new NextResponse(
      `
      <html>
        <head><title>Connection Failed</title></head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 2rem; text-align: center;">
          <h1>Connection Failed</h1>
          <p>The OAuth provider returned an error: ${error}</p>
          <p>You can close this window and try again.</p>
        </body>
      </html>
      `,
      {
        status: 400,
        headers: { 'Content-Type': 'text/html' },
      }
    )
  }

  if (!code || !state) {
    return new NextResponse('Missing code or state parameter', { status: 400 })
  }

  try {
    // Resolve app slug from cache
    const appId = await resolveAppSlug(slug)

    if (!appId) {
      return new NextResponse('App not found', { status: 404 })
    }

    // Validate state — metadata was already loaded above; just delete the token.
    const redis = await getRedisClient()
    if (!redis) {
      throw new Error('Redis client unavailable')
    }

    if (!metadata) {
      return new NextResponse('Invalid or expired state token', { status: 400 })
    }

    await redis.del(`oauth:app-connection:${state}`)

    // Verify appId matches stored state
    if (metadata.appId !== appId) {
      return new NextResponse('State validation failed', { status: 400 })
    }

    // Get connection definition using Drizzle query API
    const connDef = await db.query.ConnectionDefinition.findFirst({
      where: (cd, { eq }) => eq(cd.id, metadata.connectionDefinitionId),
    })

    if (!connDef) {
      throw new Error('Connection definition not found')
    }

    // Resolve callback base URL (must match what was sent in the authorize request)
    const features = (connDef.oauth2Features as Record<string, any>) ?? {}
    const callbackBase = features.callbackBaseUrl || OAUTH_REDIRECT_BASE

    // Interpolate connection fields with stored variables
    const connectionVariables: Record<string, string> = metadata.connectionVariables ?? {}
    const resolved = interpolateConnectionFields(connDef, connectionVariables)
    // Client id/secret follow §3.2 precedence: a per-connection BYO client wins over the
    // app's platform client (matches the authorize route + token refresh).
    const { clientId: oauthClientId, clientSecret: oauthClientSecret } = resolveOAuth2Client(
      connDef,
      connectionVariables
    )

    // Exchange authorization code for access token
    const tokenRequestBody: Record<string, string> = {
      code,
      client_id: oauthClientId,
      client_secret: oauthClientSecret,
      redirect_uri: `${callbackBase}/api/apps/${slug}/oauth2/callback`,
      grant_type: 'authorization_code',
    }

    // Add code_verifier if PKCE was used (stored during authorize)
    if (metadata.codeVerifier) {
      tokenRequestBody.code_verifier = metadata.codeVerifier
    }

    // Append additional token params from connection definition
    if (features.additionalTokenParams) {
      for (const [key, value] of Object.entries(features.additionalTokenParams)) {
        tokenRequestBody[key] = value as string
      }
    }

    // Use appropriate auth method
    const tokenRequestHeaders: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      // GitHub (and some others) return form-encoded by default; request JSON
      Accept: 'application/json',
    }

    if (connDef.oauth2TokenRequestAuthMethod === 'basic-auth') {
      const basicAuth = Buffer.from(`${oauthClientId}:${oauthClientSecret}`).toString('base64')
      tokenRequestHeaders['Authorization'] = `Basic ${basicAuth}`
      // Don't include client_id and client_secret in body for basic auth
      delete tokenRequestBody.client_id
      delete tokenRequestBody.client_secret
    }

    logger.info('Exchanging OAuth code for tokens', {
      appId,
      slug,
      installationId: metadata.installationId,
      tokenUrl: connDef.oauth2AccessTokenUrl,
    })

    const tokenResponse = await fetch(resolved.accessTokenUrl, {
      method: 'POST',
      headers: tokenRequestHeaders,
      body: new URLSearchParams(tokenRequestBody).toString(),
    })

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text()
      logger.error('Token exchange failed', {
        status: tokenResponse.status,
        error: errorText,
        appId,
        slug,
      })
      throw new Error(`Failed to exchange code for tokens: ${tokenResponse.status}`)
    }

    const tokens = await tokenResponse.json()

    // Slack (and some other providers) return HTTP 200 even on failure
    if (tokens.ok === false) {
      throw new Error(`OAuth token exchange failed: ${tokens.error}`)
    }
    if (!tokens.access_token) {
      throw new Error('OAuth token exchange returned no access_token')
    }

    logger.info('Successfully received OAuth tokens', {
      appId,
      slug,
      installationId: metadata.installationId,
      hasRefresh: !!tokens.refresh_token,
      expiresIn: tokens.expires_in,
      expiresAt: tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
        : undefined,
    })

    // Log what we're about to save
    logger.info('Saving app connection with params:', {
      appId: metadata.appId,
      installationId: metadata.installationId,
      appTitle: metadata.appTitle,
      organizationId: metadata.organizationId,
      userId: metadata.userId,
      userIdField: metadata.global ? null : metadata.userId,
      global: metadata.global,
      hasAccess: !!tokens.access_token,
      hasRefresh: !!tokens.refresh_token,
    })

    // Extract callback metadata params declared in the connection definition
    const callbackMetadata: Record<string, string> = {}
    if (features.callbackMetadataParams?.length) {
      for (const param of features.callbackMetadataParams) {
        const value = searchParams.get(param)
        if (value) callbackMetadata[param] = value
      }
    }

    // Split stored variables by the definition's secret flag: secret-flagged values are
    // encrypted under `secrets.fields`; only plain ones persist in plaintext metadata.
    const secretVariableKeys = new Set(
      (connDef.connectionVariables ?? []).filter((v) => v.secret).map((v) => v.key)
    )
    const secretFields: Record<string, string> = {}
    const plainVariables: Record<string, string> = {}
    for (const [key, value] of Object.entries(connectionVariables)) {
      if (secretVariableKeys.has(key)) secretFields[key] = value
      else plainVariables[key] = value
    }

    // Save connection to Credential
    const result = await saveAppConnection(
      metadata.appId,
      metadata.installationId,
      metadata.appTitle,
      metadata.organizationId,
      metadata.userId,
      metadata.global ? null : metadata.userId, // userId field: null for organization-wide, userId for user
      {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        ...(Object.keys(secretFields).length > 0 && { secretFields }),
        expiresAt: tokens.expires_in
          ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
          : undefined,
        metadata: {
          scope: tokens.scope,
          tokenType: tokens.token_type,
          ...callbackMetadata,
          ...(Object.keys(plainVariables).length > 0 && {
            connectionVariables: plainVariables,
          }),
        },
      },
      {
        // The method the org chose (stashed in Redis state by the authorize route) →
        // written to the credential FK so the runtime resolves the exact method.
        connectionDefinitionId: metadata.connectionDefinitionId,
        ...(metadata.connectionId && { connectionId: metadata.connectionId }),
      }
    )

    if (result.isErr()) {
      logger.error('Failed to save app connection', {
        error: result.error,
        appId,
        slug,
      })
      throw result.error
    }

    const { credentialId, matchedExisting } = result.value

    logger.info('App connection created successfully', {
      appId,
      slug,
      installationId: metadata.installationId,
      global: metadata.global,
      credentialId,
      matchedExisting,
    })

    if (isPopup) {
      const popupResponse = renderPopupTerminationPage({
        ok: true,
        credId: credentialId,
        appId: metadata.appId,
        matchedExisting,
        originOfOpener,
      })
      popupResponse.cookies.delete('oauth_return_to')
      return popupResponse
    }

    // Redirect back — use returnTo from state if available, else default to app connections page
    const successPath = metadata.returnTo || `/app/settings/apps/installed/${slug}/connections`
    const redirectUrl = buildRedirectUrl(successPath, {
      oauth_success: 'true',
      // A silent identity dedup update-in-place — the return hook toasts "already connected".
      ...(matchedExisting && { already_connected: 'true' }),
    })
    const response = NextResponse.redirect(redirectUrl)
    response.cookies.delete('oauth_return_to')
    return response
  } catch (error) {
    logger.error('OAuth callback failed', {
      error: error instanceof Error ? error.message : String(error),
      slug,
    })

    if (isPopup) {
      return renderPopupTerminationPage({
        ok: false,
        appId: metadata?.appId ?? null,
        error: error instanceof Error ? error.message : 'Unknown error',
        originOfOpener,
      })
    }

    // Try cookie fallback for returnTo on error
    const cookieReturnTo = request.cookies.get('oauth_return_to')?.value
    if (isValidReturnTo(cookieReturnTo)) {
      const errorRedirectUrl = buildRedirectUrl(cookieReturnTo, {
        oauth_error: 'true',
        oauth_error_message: error instanceof Error ? error.message : 'Unknown error',
      })
      const response = NextResponse.redirect(errorRedirectUrl)
      response.cookies.delete('oauth_return_to')
      return response
    }

    return new NextResponse(
      `
      <html>
        <head><title>Connection Failed</title></head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 2rem; text-align: center;">
          <h1>Connection Failed</h1>
          <p>An error occurred while setting up your connection.</p>
          <p style="color: #666; font-size: 0.875rem;">${error instanceof Error ? error.message : 'Unknown error'}</p>
          <p><a href="/app/settings/apps">Return to Apps</a></p>
        </body>
      </html>
      `,
      {
        status: 500,
        headers: { 'Content-Type': 'text/html' },
      }
    )
  }
}
