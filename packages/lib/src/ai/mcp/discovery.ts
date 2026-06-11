// packages/lib/src/ai/mcp/discovery.ts

import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import { withMcpSession } from './client'
import { McpAuthError } from './errors'

const logger = createScopedLogger('mcp-discovery')

export interface McpDiscoveryError {
  code: 'PROBE_FAILED' | 'METADATA_NOT_FOUND' | 'METADATA_FETCH_FAILED'
  message: string
}

export type McpAuthDiscoveryResult =
  | { kind: 'none' }
  | {
      kind: 'oauth'
      authorizationServer: string
      authorizeUrl: string
      tokenUrl: string
      registrationEndpoint?: string
      scopesSupported?: string[]
      /** RFC 8707 resource indicator — the MCP endpoint itself. */
      resource: string
    }

/** Parse a `resource_metadata="..."` directive out of a WWW-Authenticate header (RFC 9728). */
function parseResourceMetadata(header: string | undefined): string | undefined {
  if (!header) return undefined
  const match = header.match(/resource_metadata="([^"]+)"/i)
  return match?.[1]
}

async function fetchJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) return null
    return (await res.json()) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * Discover an MCP server's auth posture.
 *
 * 1. Probe `initialize` with no auth. Success → `{ kind: 'none' }`.
 * 2. On 401, parse `WWW-Authenticate` for RFC 9728 `resource_metadata` (falling back to the
 *    well-known protected-resource path), fetch it → `authorization_servers[0]`.
 * 3. Fetch the AS metadata (RFC 8414, falling back to OpenID config) → authorize/token/registration
 *    endpoints.
 */
export async function discoverMcpAuth(
  endpoint: string,
  opts?: { headers?: Record<string, string> }
): Promise<Result<McpAuthDiscoveryResult, McpDiscoveryError>> {
  // 1. Probe with the pasted (non-placeholder) headers, if any.
  try {
    await withMcpSession({ endpoint, headers: opts?.headers }, async (client) => client.listTools())
    return ok({ kind: 'none' })
  } catch (error) {
    if (!(error instanceof McpAuthError)) {
      return err({
        code: 'PROBE_FAILED',
        message: error instanceof Error ? error.message : String(error),
      })
    }
    // fall through to OAuth discovery
    return discoverOAuth(endpoint, error.wwwAuthenticate)
  }
}

async function discoverOAuth(
  endpoint: string,
  wwwAuthenticate: string | undefined
): Promise<Result<McpAuthDiscoveryResult, McpDiscoveryError>> {
  const endpointUrl = new URL(endpoint)

  // 2. Protected-resource metadata (RFC 9728).
  let prmUrl = parseResourceMetadata(wwwAuthenticate)
  if (!prmUrl) {
    prmUrl = `${endpointUrl.origin}/.well-known/oauth-protected-resource${endpointUrl.pathname}`
  }
  let prm = await fetchJson(prmUrl)
  if (!prm) {
    // bare-origin fallback
    prm = await fetchJson(`${endpointUrl.origin}/.well-known/oauth-protected-resource`)
  }
  const authServers = prm?.authorization_servers
  const authorizationServer = Array.isArray(authServers) ? String(authServers[0]) : undefined
  if (!authorizationServer) {
    return err({ code: 'METADATA_NOT_FOUND', message: 'No authorization server advertised' })
  }

  // 3. Authorization-server metadata (RFC 8414 → OpenID fallback).
  const asUrl = new URL(authorizationServer)
  const asMeta =
    (await fetchJson(`${asUrl.origin}/.well-known/oauth-authorization-server${asUrl.pathname}`)) ??
    (await fetchJson(`${asUrl.origin}/.well-known/oauth-authorization-server`)) ??
    (await fetchJson(`${asUrl.origin}/.well-known/openid-configuration`))
  if (!asMeta) {
    return err({ code: 'METADATA_FETCH_FAILED', message: 'AS metadata unavailable' })
  }

  const authorizeUrl = asMeta.authorization_endpoint as string | undefined
  const tokenUrl = asMeta.token_endpoint as string | undefined
  if (!authorizeUrl || !tokenUrl) {
    return err({ code: 'METADATA_FETCH_FAILED', message: 'AS metadata missing endpoints' })
  }

  logger.info('Discovered MCP OAuth', { endpoint, authorizationServer })
  return ok({
    kind: 'oauth',
    authorizationServer,
    authorizeUrl,
    tokenUrl,
    registrationEndpoint: asMeta.registration_endpoint as string | undefined,
    scopesSupported: Array.isArray(asMeta.scopes_supported)
      ? (asMeta.scopes_supported as string[])
      : undefined,
    resource: endpoint,
  })
}

export interface DcrError {
  code: 'DCR_FAILED'
  message: string
}

/**
 * RFC 7591 Dynamic Client Registration. Public clients (no secret returned) are fine — PKCE
 * covers them. Returns the minted client id (+ optional secret + registration access token).
 */
export async function registerDcrClient(opts: {
  registrationEndpoint: string
  redirectUri: string
  serverName: string
}): Promise<
  Result<{ clientId: string; clientSecret?: string; registrationAccessToken?: string }, DcrError>
> {
  try {
    const res = await fetch(opts.registrationEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        redirect_uris: [opts.redirectUri],
        token_endpoint_auth_method: 'client_secret_post',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        client_name: `Auxx.ai — ${opts.serverName}`,
      }),
    })
    if (!res.ok) {
      const text = await res.text()
      return err({
        code: 'DCR_FAILED',
        message: `DCR returned ${res.status}: ${text.slice(0, 200)}`,
      })
    }
    const body = (await res.json()) as Record<string, unknown>
    const clientId = body.client_id as string | undefined
    if (!clientId) {
      return err({ code: 'DCR_FAILED', message: 'DCR response missing client_id' })
    }
    return ok({
      clientId,
      clientSecret: (body.client_secret as string | undefined) || undefined,
      registrationAccessToken: (body.registration_access_token as string | undefined) || undefined,
    })
  } catch (error) {
    return err({
      code: 'DCR_FAILED',
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
