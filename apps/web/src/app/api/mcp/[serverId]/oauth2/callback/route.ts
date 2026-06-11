// apps/web/src/app/api/mcp/[serverId]/oauth2/callback/route.ts

import { WEBAPP_URL } from '@auxx/config/urls'
import { database as db } from '@auxx/database'
import { saveMcpConnection, syncMcpTools } from '@auxx/lib/ai/mcp'
import { onCacheEvent } from '@auxx/lib/cache'
import { createScopedLogger } from '@auxx/logger'
import { getRedisClient } from '@auxx/redis'
import { interpolateConnectionFields } from '@auxx/services/app-connections'
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

/** Popup termination page — postMessage to opener + BroadcastChannel('oauth-mcp-connect'), close. */
function renderPopupTerminationPage(payload: {
  ok: boolean
  error?: string | null
  originOfOpener: string
}): NextResponse {
  const message = { type: 'oauth_done', ok: payload.ok, error: payload.error ?? null }
  const serializedMessage = JSON.stringify(message).replace(/</g, '\\u003c')
  const serializedOrigin = JSON.stringify(payload.originOfOpener).replace(/</g, '\\u003c')
  const heading = payload.ok ? 'Connected' : 'Connection failed'
  const body = payload.ok
    ? 'You can close this window.'
    : `Something went wrong: ${payload.error ?? 'Unknown error'}. You can close this window.`
  const html = `<!doctype html>
<html><head><title>${heading}</title></head>
<body style="font-family: -apple-system, sans-serif; padding: 2rem; text-align: center;">
<h1>${heading}</h1><p>${body}</p>
<script>(function(){var p=${serializedMessage};var o=${serializedOrigin};
try{if(window.opener){window.opener.postMessage(p,o);}}catch(_){}
try{var bc=new BroadcastChannel('oauth-mcp-connect');bc.postMessage(p);bc.close();}catch(_){}
try{window.close();}catch(_){}})();</script>
</body></html>`
  return new NextResponse(html, {
    status: payload.ok ? 200 : 400,
    headers: { 'Content-Type': 'text/html' },
  })
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ serverId: string }> }
) {
  const searchParams = request.nextUrl.searchParams
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const providerError = searchParams.get('error')
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
    logger.error('MCP OAuth provider error', { providerError, serverId })
    if (state) {
      try {
        const redis = await getRedisClient()
        await redis?.del(`oauth:mcp-connection:${state}`)
      } catch {}
    }
    if (isPopup)
      return renderPopupTerminationPage({ ok: false, error: providerError, originOfOpener })
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

    if (isPopup) {
      const res = renderPopupTerminationPage({ ok: true, originOfOpener })
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
      return renderPopupTerminationPage({
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
