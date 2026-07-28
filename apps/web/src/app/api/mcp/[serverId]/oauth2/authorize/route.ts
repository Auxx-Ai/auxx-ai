// apps/web/src/app/api/mcp/[serverId]/oauth2/authorize/route.ts

import { WEBAPP_URL } from '@auxx/config/urls'
import type { OAuth2Features } from '@auxx/database'
import { database as db } from '@auxx/database'
import { resolveMcpConnectionForRuntime } from '@auxx/lib/ai/mcp'
import { AuxxError } from '@auxx/lib/errors'
import { PermissionKey, requirePermission } from '@auxx/lib/permissions'
import { createScopedLogger } from '@auxx/logger'
import { getRedisClient } from '@auxx/redis'
import { interpolateConnectionFields } from '@auxx/services/app-connections'
import crypto from 'crypto'
import { headers } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '~/auth/server'

const OAUTH_REDIRECT_BASE = process.env.NGROK_URL || WEBAPP_URL
const logger = createScopedLogger('mcp-oauth-authorize')

/**
 * MCP OAuth authorize — mirrors the app route at `/api/apps/[slug]/oauth2/authorize`, keyed on
 * `McpServer.id` instead of an app slug + installation. Always uses PKCE and appends the RFC 8707
 * `resource` indicator (the MCP endpoint) per the MCP spec.
 *
 * Gated on `integrationsManage`, matching `mcpAdminProcedure` — the tRPC sibling `mcp.connect`
 * and every other mutating MCP procedure. This handler leads to an ORG-LEVEL credential write
 * (its callback calls `saveMcpConnection` with the `organizationId` stashed in Redis state), so
 * before this gate any authenticated member could enumerate server ids via the bare
 * `protectedProcedure` `mcp.list` and connect an org-wide MCP credential.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ serverId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const organizationId = (session.user as { defaultOrganizationId?: string }).defaultOrganizationId
  if (!organizationId) {
    return NextResponse.json({ error: 'No organization' }, { status: 401 })
  }

  // Ahead of every read, the Redis state write and the redirect. Returned explicitly so the
  // AuxxError keeps its own 403 instead of being swallowed by the outer 500 handler below.
  try {
    await requirePermission(session.user.id, organizationId, PermissionKey.integrationsManage)
  } catch (permissionError) {
    if (permissionError instanceof AuxxError) {
      return NextResponse.json(
        { error: permissionError.message },
        { status: permissionError.statusCode }
      )
    }
    throw permissionError
  }

  const { serverId } = await params
  const searchParams = request.nextUrl.searchParams
  const connectionId = searchParams.get('connectionId') // reconnect mode
  const returnTo = searchParams.get('returnTo')
  const mode = searchParams.get('mode') === 'popup' ? 'popup' : 'redirect'
  const validReturnTo = returnTo?.startsWith('/') && !returnTo.startsWith('//') ? returnTo : null

  const reqHeaders = await headers()
  let originOfOpener: string = WEBAPP_URL
  const originHeader = reqHeaders.get('origin')
  const referer = reqHeaders.get('referer')
  if (originHeader) originOfOpener = originHeader
  else if (referer) {
    try {
      originOfOpener = new URL(referer).origin
    } catch {
      /* keep fallback */
    }
  }

  try {
    // Authorize iff curated (null org) or owned by the session org.
    const server = await db.query.McpServer.findFirst({
      where: (s, { eq }) => eq(s.id, serverId),
      columns: { id: true, organizationId: true, name: true, endpoint: true },
    })
    if (!server || (server.organizationId !== null && server.organizationId !== organizationId)) {
      return NextResponse.json({ error: 'Server not found' }, { status: 404 })
    }

    const connDef = await db.query.ConnectionDefinition.findFirst({
      where: (cd, { eq }) => eq(cd.mcpServerId, serverId),
    })
    if (!connDef || connDef.connectionType !== 'oauth2-code') {
      return NextResponse.json({ error: 'OAuth not configured for this server' }, { status: 400 })
    }

    const state = crypto.randomBytes(32).toString('hex')
    const features = (connDef.oauth2Features ?? {}) as OAuth2Features
    // MCP always uses PKCE.
    const codeVerifier = crypto.randomBytes(96).toString('base64url')

    // Connection variables (var_* params, or reuse stored ones on reconnect).
    let storedVariables: Record<string, string> = {}
    if (connectionId) {
      const resolved = await resolveMcpConnectionForRuntime({
        mcpServerId: serverId,
        organizationId,
      })
      if (resolved.isOk()) {
        const vars = resolved.value.metadata?.connectionVariables
        if (vars && typeof vars === 'object') storedVariables = vars as Record<string, string>
      }
    }
    const connectionVariables: Record<string, string> = {}
    for (const varDef of connDef.connectionVariables ?? []) {
      const value = searchParams.get(`var_${varDef.key}`) ?? storedVariables[varDef.key]
      if (!value && varDef.required !== false) {
        return NextResponse.json({ error: `Missing variable: ${varDef.label}` }, { status: 400 })
      }
      if (value) connectionVariables[varDef.key] = value
    }

    const resolved = interpolateConnectionFields(connDef, connectionVariables)

    const redis = await getRedisClient()
    await redis.setex(
      `oauth:mcp-connection:${state}`,
      600,
      JSON.stringify({
        userId: session.user.id,
        organizationId,
        mcpServerId: serverId,
        serverName: server.name,
        connectionDefinitionId: connDef.id,
        ...(connectionId && { connectionId }),
        codeVerifier,
        ...(validReturnTo && { returnTo: validReturnTo }),
        ...(Object.keys(connectionVariables).length > 0 && { connectionVariables }),
        mode,
        originOfOpener,
      })
    )

    const callbackBase = features.callbackBaseUrl || OAUTH_REDIRECT_BASE
    const authUrl = new URL(resolved.authorizeUrl)
    authUrl.searchParams.set('client_id', resolved.clientId)
    authUrl.searchParams.set('redirect_uri', `${callbackBase}/api/mcp/${serverId}/oauth2/callback`)
    authUrl.searchParams.set(
      'scope',
      (connDef.oauth2Scopes ?? []).join(features.scopeSeparator || ' ')
    )
    authUrl.searchParams.set('state', state)
    authUrl.searchParams.set('response_type', 'code')
    // RFC 8707 resource indicator — the MCP endpoint. Harmless when ignored.
    authUrl.searchParams.set('resource', server.endpoint)
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')
    authUrl.searchParams.set('code_challenge', codeChallenge)
    authUrl.searchParams.set('code_challenge_method', 'S256')
    for (const [key, value] of Object.entries(features.additionalAuthorizeParams ?? {})) {
      authUrl.searchParams.set(key, value)
    }

    logger.info('Redirecting to MCP OAuth provider', {
      serverId,
      authorizeUrl: resolved.authorizeUrl,
    })
    const response = NextResponse.redirect(authUrl.toString())
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
    logger.error('MCP OAuth authorize failed', {
      serverId,
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Failed to initiate OAuth' }, { status: 500 })
  }
}
