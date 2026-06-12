// apps/web/src/app/api/mcp/[serverId]/oauth2/callback/route.ts

import { WEBAPP_URL } from '@auxx/config/urls'
import { database as db, schema } from '@auxx/database'
import { saveMcpConnection, syncMcpTools } from '@auxx/lib/ai/mcp'
import { onCacheEvent } from '@auxx/lib/cache'
import { createScopedLogger } from '@auxx/logger'
import { getRedisClient } from '@auxx/redis'
import { interpolateConnectionFields } from '@auxx/services/app-connections'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'

const OAUTH_REDIRECT_BASE = process.env.NGROK_URL || WEBAPP_URL
const logger = createScopedLogger('mcp-oauth-callback')

function buildRedirectUrl(basePath: string, params: Record<string, string>): string {
  const url = new URL(basePath, WEBAPP_URL)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return url.toString()
}

function isValidReturnTo(value: string | undefined | null): value is string {
  return !!value && value.startsWith('/') && !value.startsWith('//')
}

/** Origins allowed to host the popup termination page (the app window's own origin). */
const TERMINATION_ORIGINS = [WEBAPP_URL, process.env.NGROK_URL].filter(Boolean) as string[]

/**
 * Redirect the popup to the termination page on the *opener's* origin.
 *
 * The callback runs on the public tunnel origin (NGROK_URL) so providers like Stripe can reach
 * it, but a cross-origin popup can't notify the app window — `BroadcastChannel` is origin-scoped
 * and `window.opener` is often severed by the provider's COOP header. Bouncing the popup back to
 * the app origin (`/api/mcp/oauth-complete`) lets both channels deliver the result. `originOfOpener`
 * is validated against an allowlist to avoid an open redirect.
 */
function popupTerminationRedirect(payload: {
  ok: boolean
  error?: string | null
  originOfOpener: string
}): NextResponse {
  const origin = TERMINATION_ORIGINS.includes(payload.originOfOpener)
    ? payload.originOfOpener
    : WEBAPP_URL
  const url = new URL('/api/mcp/oauth-complete', origin)
  url.searchParams.set('ok', String(payload.ok))
  if (!payload.ok && payload.error) url.searchParams.set('error', payload.error)
  return NextResponse.redirect(url.toString())
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ serverId: string }> }
) {
  const searchParams = request.nextUrl.searchParams
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const providerError = searchParams.get('error')
  const providerErrorDescription = searchParams.get('error_description')
  const { serverId } = await params

  let metadata: Record<string, unknown> | null = null
  if (state) {
    try {
      const redis = await getRedisClient()
      const stateData = await redis?.get(`oauth:mcp-connection:${state}`)
      if (stateData) metadata = JSON.parse(stateData)
    } catch {
      /* fall through */
    }
  }
  const isPopup = metadata?.mode === 'popup'
  const originOfOpener = (metadata?.originOfOpener as string) || WEBAPP_URL

  if (providerError) {
    logger.error('MCP OAuth provider error', {
      providerError,
      providerErrorDescription,
      serverId,
    })
    if (state) {
      try {
        const redis = await getRedisClient()
        await redis?.del(`oauth:mcp-connection:${state}`)
      } catch {}
    }
    if (isPopup)
      return popupTerminationRedirect({ ok: false, error: providerError, originOfOpener })
    return new NextResponse(`OAuth error: ${providerError}`, { status: 400 })
  }

  if (!code || !state) return new NextResponse('Missing code or state', { status: 400 })

  try {
    const redis = await getRedisClient()
    if (!redis) throw new Error('Redis unavailable')
    if (!metadata) return new NextResponse('Invalid or expired state token', { status: 400 })
    if (metadata.mcpServerId !== serverId) {
      return new NextResponse('State validation failed', { status: 400 })
    }
    await redis.del(`oauth:mcp-connection:${state}`)

    const connDef = await db.query.ConnectionDefinition.findFirst({
      where: (cd, { eq }) => eq(cd.id, metadata.connectionDefinitionId as string),
    })
    if (!connDef) throw new Error('Connection definition not found')

    const server = await db.query.McpServer.findFirst({
      where: (s, { eq }) => eq(s.id, serverId),
      columns: { slug: true, endpoint: true },
    })

    const features = (connDef.oauth2Features ?? {}) as Record<string, unknown>
    const callbackBase = (features.callbackBaseUrl as string) || OAUTH_REDIRECT_BASE
    const connectionVariables = (metadata.connectionVariables as Record<string, string>) ?? {}
    const resolved = interpolateConnectionFields(connDef, connectionVariables)

    const tokenRequestBody: Record<string, string> = {
      code,
      client_id: resolved.clientId,
      redirect_uri: `${callbackBase}/api/mcp/${serverId}/oauth2/callback`,
      grant_type: 'authorization_code',
      // RFC 8707 resource indicator — required by the MCP spec on the token request too.
      resource: server?.endpoint ?? '',
    }
    if (resolved.clientSecret) tokenRequestBody.client_secret = resolved.clientSecret
    if (metadata.codeVerifier) tokenRequestBody.code_verifier = metadata.codeVerifier as string

    const tokenResponse = await fetch(resolved.accessTokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams(tokenRequestBody).toString(),
    })
    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text()
      throw new Error(`Token exchange failed: ${tokenResponse.status} ${errorText.slice(0, 200)}`)
    }
    const tokens = await tokenResponse.json()
    if (!tokens.access_token) throw new Error('Token exchange returned no access_token')

    const saved = await saveMcpConnection({
      mcpServerId: serverId,
      serverName: (metadata.serverName as string) ?? 'MCP Server',
      organizationId: metadata.organizationId as string,
      createdById: metadata.userId as string,
      connectionData: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: tokens.expires_in
          ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
          : undefined,
        metadata: {
          scope: tokens.scope,
          tokenType: tokens.token_type,
          ...(Object.keys(connectionVariables).length > 0 && { connectionVariables }),
        },
      },
      connectionId: metadata.connectionId as string | undefined,
    })
    if (saved.isErr()) throw saved.error

    // Enroll the credential in the proactive refresh scanner: stamp the refresh cadence from the
    // token TTL (30-min floor — the 15-min scanner can't keep shorter tokens warm; the lazy
    // refresh-on-expiry and 401-retry paths carry those).
    if (tokens.expires_in && tokens.refresh_token) {
      const intervalSeconds = Math.max(Number(tokens.expires_in), 1800)
      if (intervalSeconds !== connDef.oauth2RefreshTokenIntervalSeconds) {
        await db
          .update(schema.ConnectionDefinition)
          .set({ oauth2RefreshTokenIntervalSeconds: intervalSeconds })
          .where(eq(schema.ConnectionDefinition.id, connDef.id))
      }
    }

    // First snapshot needs the token — best effort, never fail the connect on a sync error.
    try {
      await syncMcpTools({
        mcpServerId: serverId,
        organizationId: metadata.organizationId as string,
      })
    } catch (syncError) {
      logger.warn('Inline sync after connect failed', {
        serverId,
        error: syncError instanceof Error ? syncError.message : String(syncError),
      })
    }
    await onCacheEvent('mcp.connection.changed', { orgId: metadata.organizationId as string })
    logger.info('MCP connect complete', {
      serverId,
      organizationId: metadata.organizationId as string,
    })

    if (isPopup) {
      const res = popupTerminationRedirect({ ok: true, originOfOpener })
      res.cookies.delete('oauth_return_to')
      return res
    }
    const successPath =
      (metadata.returnTo as string) || `/app/settings/apps/mcp/${server?.slug ?? ''}`
    const res = NextResponse.redirect(buildRedirectUrl(successPath, { oauth_success: 'true' }))
    res.cookies.delete('oauth_return_to')
    return res
  } catch (error) {
    logger.error('MCP OAuth callback failed', {
      serverId,
      error: error instanceof Error ? error.message : String(error),
    })
    if (isPopup) {
      return popupTerminationRedirect({
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        originOfOpener,
      })
    }
    const cookieReturnTo = request.cookies.get('oauth_return_to')?.value
    if (isValidReturnTo(cookieReturnTo)) {
      const res = NextResponse.redirect(
        buildRedirectUrl(cookieReturnTo, {
          oauth_error: 'true',
          oauth_error_message: error instanceof Error ? error.message : 'Unknown error',
        })
      )
      res.cookies.delete('oauth_return_to')
      return res
    }
    return new NextResponse('MCP connection failed', { status: 500 })
  }
}
