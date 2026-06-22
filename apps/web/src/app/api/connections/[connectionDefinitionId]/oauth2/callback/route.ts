// apps/web/src/app/api/connections/[connectionDefinitionId]/oauth2/callback/route.ts

import { WEBAPP_URL } from '@auxx/config/urls'
import { database as db } from '@auxx/database'
import { resolveOAuth2Client, runPostConnectHook, saveConnection } from '@auxx/lib/connections'
import { createScopedLogger } from '@auxx/logger'
import { getRedisClient } from '@auxx/redis'
import { interpolateConnectionFields } from '@auxx/services/app-connections'
import { type NextRequest, NextResponse } from 'next/server'

const OAUTH_REDIRECT_BASE = process.env.NGROK_URL || WEBAPP_URL

const logger = createScopedLogger('connection-oauth-callback')

/** Build a redirect URL safely using URL/URLSearchParams. */
function buildRedirectUrl(basePath: string, params: Record<string, string>): string {
  const url = new URL(basePath, WEBAPP_URL)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  return url.toString()
}

/** Validate a returnTo value — must be a relative path, not protocol-relative. */
function isValidReturnTo(value: string | undefined | null): value is string {
  return !!value && value.startsWith('/') && !value.startsWith('//')
}

/**
 * Render the popup-mode termination page: post a result to the opener (targeted at the stored
 * origin) and over BroadcastChannel, then close. Values are JSON-stringified so they cannot break
 * out of the script context. Mirrors the app-connection popup so the shared connect flow handles
 * both identically.
 */
function renderPopupTerminationPage(payload: {
  ok: boolean
  credId?: string | null
  error?: string | null
  originOfOpener: string
}): NextResponse {
  const message = {
    type: 'oauth_done',
    ok: payload.ok,
    credId: payload.credId ?? null,
    error: payload.error ?? null,
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
 * Generalized OAuth Callback Route — any owner (app / mcp / platform built-in).
 * GET /api/connections/:connectionDefinitionId/oauth2/callback
 *
 * Exchanges the authorization code for tokens and persists the credential via saveConnection.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ connectionDefinitionId: string }> }
) {
  const searchParams = request.nextUrl.searchParams
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')
  const { connectionDefinitionId: defParam } = await params

  // Peek at stored state up-front so every termination branch can pick popup vs redirect.
  let metadata: any = null
  if (state) {
    try {
      const redis = await getRedisClient()
      if (redis) {
        const stateData = await redis.get(`oauth:connection:${state}`)
        if (stateData) metadata = JSON.parse(stateData)
      }
    } catch {
      // ignore — fall through to validation below
    }
  }
  const isPopup = metadata?.mode === 'popup'
  const originOfOpener: string = metadata?.originOfOpener || WEBAPP_URL

  // Provider-side error (e.g. user denied)
  if (error) {
    logger.error('OAuth provider returned error', { error, defParam })

    if (isPopup) {
      if (state) {
        try {
          const redis = await getRedisClient()
          await redis?.del(`oauth:connection:${state}`)
        } catch {}
      }
      return renderPopupTerminationPage({ ok: false, error, originOfOpener })
    }

    const cookieReturnTo = request.cookies.get('oauth_return_to')?.value
    if (isValidReturnTo(cookieReturnTo)) {
      const response = NextResponse.redirect(
        buildRedirectUrl(cookieReturnTo, { oauth_error: 'true', oauth_error_message: error })
      )
      response.cookies.delete('oauth_return_to')
      return response
    }

    return new NextResponse(`OAuth provider returned an error: ${error}`, { status: 400 })
  }

  if (!code || !state) {
    return new NextResponse('Missing code or state parameter', { status: 400 })
  }

  try {
    const redis = await getRedisClient()
    if (!redis) {
      throw new Error('Redis client unavailable')
    }

    if (!metadata) {
      return new NextResponse('Invalid or expired state token', { status: 400 })
    }

    await redis.del(`oauth:connection:${state}`)

    const connDef = await db.query.ConnectionDefinition.findFirst({
      where: (cd, { eq }) => eq(cd.id, metadata.connectionDefinitionId),
    })

    if (!connDef) {
      throw new Error('Connection definition not found')
    }

    const features = (connDef.oauth2Features as Record<string, any>) ?? {}
    const callbackBase = features.callbackBaseUrl || OAUTH_REDIRECT_BASE
    const connectionVariables: Record<string, string> = metadata.connectionVariables ?? {}
    const resolved = interpolateConnectionFields(connDef, connectionVariables)
    // Client id/secret follow the §3.2 precedence — must match the client that minted
    // the auth code (BYO client when the connect launched with one).
    const { clientId, clientSecret } = resolveOAuth2Client(connDef, connectionVariables)

    // Exchange the authorization code for an access token
    const tokenRequestBody: Record<string, string> = {
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: `${callbackBase}/api/connections/${defParam}/oauth2/callback`,
      grant_type: 'authorization_code',
    }

    if (metadata.codeVerifier) {
      tokenRequestBody.code_verifier = metadata.codeVerifier
    }

    if (features.additionalTokenParams) {
      for (const [key, value] of Object.entries(features.additionalTokenParams)) {
        tokenRequestBody[key] = value as string
      }
    }

    const tokenRequestHeaders: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    }

    if (connDef.oauth2TokenRequestAuthMethod === 'basic-auth') {
      const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
      tokenRequestHeaders['Authorization'] = `Basic ${basicAuth}`
      delete tokenRequestBody.client_id
      delete tokenRequestBody.client_secret
    }

    logger.info('Exchanging OAuth code for tokens', {
      connectionDefinitionId: connDef.id,
      providerKey: connDef.providerKey,
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
        connectionDefinitionId: connDef.id,
      })
      throw new Error(`Failed to exchange code for tokens: ${tokenResponse.status}`)
    }

    const tokens = await tokenResponse.json()

    // Slack (and some others) return HTTP 200 even on failure
    if (tokens.ok === false) {
      throw new Error(`OAuth token exchange failed: ${tokens.error}`)
    }
    if (!tokens.access_token) {
      throw new Error('OAuth token exchange returned no access_token')
    }

    // Extract callback metadata params declared on the definition
    const callbackMetadata: Record<string, string> = {}
    if (features.callbackMetadataParams?.length) {
      for (const param of features.callbackMetadataParams) {
        const value = searchParams.get(param)
        if (value) callbackMetadata[param] = value
      }
    }

    // Split stored variables by the definition's secret flag: secret-flagged values are encrypted
    // under `secrets.fields`; plain ones persist in plaintext metadata.
    const secretVariableKeys = new Set(
      (connDef.connectionVariables ?? []).filter((v) => v.secret).map((v) => v.key)
    )
    const secretFields: Record<string, string> = {}
    const plainVariables: Record<string, string> = {}
    for (const [key, value] of Object.entries(connectionVariables)) {
      if (secretVariableKeys.has(key)) secretFields[key] = value
      else plainVariables[key] = value
    }

    const result = await saveConnection({
      connectionDefinitionId: connDef.id,
      providerKey: metadata.providerKey,
      name: metadata.connectionName,
      organizationId: metadata.organizationId,
      createdById: metadata.userId,
      userId: metadata.global ? null : metadata.userId,
      connectionData: {
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
          ...(Object.keys(plainVariables).length > 0 && { connectionVariables: plainVariables }),
        },
      },
      ...(metadata.connectionId && { connectionId: metadata.connectionId }),
    })

    if (result.isErr()) {
      logger.error('Failed to save connection', {
        error: result.error,
        connectionDefinitionId: connDef.id,
      })
      throw result.error
    }

    logger.info('Connection created successfully', {
      connectionDefinitionId: connDef.id,
      providerKey: connDef.providerKey,
      global: metadata.global,
      credentialId: result.value,
    })

    // Run the provider's post-connect provisioning hook (channels create their Integration
    // + inbox link + webhook arming here). The credential is already committed, so the hook
    // can resolve a fresh token. A failure surfaces via the shared error redirect below so a
    // half-provisioned channel never looks connected.
    if (connDef.providerKey) {
      await runPostConnectHook(connDef.providerKey, {
        credentialId: result.value,
        providerKey: connDef.providerKey,
        organizationId: metadata.organizationId,
        userId: metadata.userId,
        ...(metadata.connectionId && { connectionId: metadata.connectionId }),
        ...(metadata.postConnect && { extra: metadata.postConnect }),
      })
    }

    if (isPopup) {
      const popupResponse = renderPopupTerminationPage({
        ok: true,
        credId: result.value,
        originOfOpener,
      })
      popupResponse.cookies.delete('oauth_return_to')
      return popupResponse
    }

    const successPath = metadata.returnTo || '/app'
    const response = NextResponse.redirect(buildRedirectUrl(successPath, { oauth_success: 'true' }))
    response.cookies.delete('oauth_return_to')
    return response
  } catch (error) {
    logger.error('OAuth callback failed', {
      error: error instanceof Error ? error.message : String(error),
      defParam,
    })

    if (isPopup) {
      return renderPopupTerminationPage({
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        originOfOpener,
      })
    }

    const cookieReturnTo = request.cookies.get('oauth_return_to')?.value
    if (isValidReturnTo(cookieReturnTo)) {
      const response = NextResponse.redirect(
        buildRedirectUrl(cookieReturnTo, {
          oauth_error: 'true',
          oauth_error_message: error instanceof Error ? error.message : 'Unknown error',
        })
      )
      response.cookies.delete('oauth_return_to')
      return response
    }

    return new NextResponse(
      `An error occurred while setting up your connection: ${error instanceof Error ? error.message : 'Unknown error'}`,
      { status: 500 }
    )
  }
}
