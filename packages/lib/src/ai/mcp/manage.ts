// packages/lib/src/ai/mcp/manage.ts
//
// Server-management orchestration for the `mcp` tRPC router (create custom servers, connect
// curated servers, refresh, rename, delete). Kept out of the router per the >20-line rule.

import { WEBAPP_URL } from '@auxx/config/urls'
import { encryptValue, isMaskEcho } from '@auxx/credentials/crypto'
import { findCredential } from '@auxx/credentials/store'
import { database as db, type McpServerIcon, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNull, or } from 'drizzle-orm'
import { onCacheEvent } from '../../cache/invalidate'
import { deleteMcpConnection, saveMcpConnection } from './connections'
import { discoverMcpAuth, registerDcrClient } from './discovery'
import { syncMcpTools } from './sync'
import { mcpTemplates } from './templates/catalog'
import { ensureCuratedMcpServer } from './templates/ensure'

const logger = createScopedLogger('mcp-manage')
const CALLBACK_BASE = process.env.NGROK_URL || WEBAPP_URL

/** Result of a create/connect attempt — the UI forks on which flag is set. */
export type McpConnectOutcome =
  | { connected: true }
  | { needsOAuth: true; authorizeUrl: string }
  | { needsClientCredentials: true }

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'mcp-server'
  )
}

/** Make a slug unique within the org (curated + org-owned share the namespace). */
async function uniqueSlug(organizationId: string, base: string): Promise<string> {
  const existing = await db.query.McpServer.findMany({
    where: or(
      isNull(schema.McpServer.organizationId),
      eq(schema.McpServer.organizationId, organizationId)
    ),
    columns: { slug: true },
  })
  const taken = new Set(existing.map((s) => s.slug))
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}

/** Encrypt non-empty client creds; empty/null pass through so presence semantics survive. */
function encryptCred(value: string | null): string | null {
  return value ? encryptValue(value) : value
}

function authorizeUrlFor(serverId: string, returnTo?: string): string {
  const qs = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''
  return `/api/mcp/${serverId}/oauth2/authorize${qs}`
}

/**
 * The OAuth redirect URI for a server — what the user registers at the provider when DCR
 * isn't available. Server-side only: `CALLBACK_BASE` can be an ngrok URL in dev, which the
 * browser can't derive.
 */
export function mcpRedirectUri(serverId: string): string {
  return `${CALLBACK_BASE}/api/mcp/${serverId}/oauth2/callback`
}

/** Manual OAuth client config + endpoint overrides pasted in the create/edit dialog. */
export interface McpOAuthConfigInput {
  clientId?: string
  clientSecret?: string
  /** With `tokenUrl`, skips RFC 9728/8414 discovery entirely. */
  authorizeUrl?: string
  tokenUrl?: string
  scopes?: string[]
}

/** name → value map from repeatable header rows. */
function headerMap(headers: Array<{ name: string; value: string }>): Record<string, string> {
  return Object.fromEntries(headers.map((h) => [h.name, h.value]))
}

/**
 * Create an org-owned custom MCP server from a pasted URL.
 *  - `auto` → discover auth posture (none or oauth).
 *  - bearer/headers/none → save connection + sync → `{ connected: true }`.
 *  - oauth → pasted client creds / DCR → `{ needsOAuth }`; DCR failure → `{ needsClientCredentials }`.
 *    Manual authorize/token URL overrides skip discovery for servers without OAuth metadata.
 */
export async function createCustomMcpServer(input: {
  organizationId: string
  createdById: string
  name: string
  endpoint: string
  auth: 'auto' | 'oauth' | 'bearer' | 'headers' | 'none'
  token?: string
  /** Non-`Authorization` header name for the bearer token (e.g. `X-API-Key`). */
  authHeaderName?: string
  /** Custom-header auth rows (`auth: 'headers'`). */
  headers?: Array<{ name: string; value: string }>
  /** OAuth client creds + endpoint overrides (`auth: 'oauth'`, or auto-discovered OAuth). */
  oauth?: McpOAuthConfigInput
  /** Enrichment lifted from the resolved snippet (registry / favicon). */
  description?: string
  icon?: McpServerIcon
  returnTo?: string
}): Promise<McpConnectOutcome & { serverId: string; slug: string }> {
  let mode: 'none' | 'bearer' | 'headers' | 'oauth' = input.auth === 'auto' ? 'none' : input.auth
  const hasOAuthOverrides = !!(input.oauth?.authorizeUrl && input.oauth?.tokenUrl)

  // Discovery runs for auto (to learn the posture) and for explicit OAuth without manual URLs.
  let discovered: Awaited<ReturnType<typeof discoverMcpAuth>> | null = null
  if (input.auth === 'auto' || (input.auth === 'oauth' && !hasOAuthOverrides)) {
    discovered = await discoverMcpAuth(input.endpoint)
    if (input.auth === 'auto' && discovered.isOk()) {
      mode = discovered.value.kind === 'oauth' ? 'oauth' : 'none'
    }
  }
  const oauthMeta =
    discovered?.isOk() && discovered.value.kind === 'oauth' ? discovered.value : null

  if (input.auth === 'oauth' && !hasOAuthOverrides && !oauthMeta) {
    throw new Error(
      'OAuth discovery failed for this endpoint — provide the authorize and token URLs under Advanced OAuth settings.'
    )
  }

  // Retry-safe: an org server already pointing at this endpoint is reused (e.g. clicking Connect
  // again after a missed OAuth popup result) instead of inserting a duplicate.
  const existing = await db.query.McpServer.findFirst({
    where: and(
      eq(schema.McpServer.organizationId, input.organizationId),
      eq(schema.McpServer.endpoint, input.endpoint)
    ),
    columns: { id: true, slug: true },
  })

  let serverId: string
  let slug: string
  let existingClientId: string | null = null
  if (existing) {
    serverId = existing.id
    slug = existing.slug
    if (input.oauth && Object.values(input.oauth).some((v) => v !== undefined)) {
      await db
        .update(schema.ConnectionDefinition)
        .set({
          ...(input.oauth.clientId !== undefined && {
            oauth2ClientId: encryptCred(input.oauth.clientId),
          }),
          // Blank/omitted secret keeps the stored (possibly DCR-minted) one; so does a
          // masked-prefill echo (HIDDEN_VALUE or mask-shaped) — never persist the mask.
          ...(input.oauth.clientSecret !== undefined &&
            !isMaskEcho(input.oauth.clientSecret) && {
              oauth2ClientSecret: encryptCred(input.oauth.clientSecret),
            }),
          ...(input.oauth.authorizeUrl !== undefined && {
            oauth2AuthorizeUrl: input.oauth.authorizeUrl,
          }),
          ...(input.oauth.tokenUrl !== undefined && {
            oauth2AccessTokenUrl: input.oauth.tokenUrl,
          }),
          ...(input.oauth.scopes !== undefined && { oauth2Scopes: input.oauth.scopes }),
        })
        .where(eq(schema.ConnectionDefinition.mcpServerId, serverId))
    }
    if (!input.oauth?.clientId) {
      const def = await db.query.ConnectionDefinition.findFirst({
        where: eq(schema.ConnectionDefinition.mcpServerId, serverId),
        columns: { oauth2ClientId: true },
      })
      existingClientId = def?.oauth2ClientId ?? null
    }
  } else {
    // New server — there is no stored secret a mask echo could "keep"; reject it outright.
    if (input.oauth?.clientSecret && isMaskEcho(input.oauth.clientSecret)) {
      throw new Error('Client secret looks like a masked placeholder — paste the real secret.')
    }
    slug = await uniqueSlug(input.organizationId, slugify(input.name))
    const [server] = await db
      .insert(schema.McpServer)
      .values({
        organizationId: input.organizationId,
        slug,
        name: input.name,
        endpoint: input.endpoint,
        description: input.description ?? null,
        icon: input.icon ?? null,
        createdById: input.createdById,
        authDiscovery: oauthMeta
          ? {
              authorizationServer: oauthMeta.authorizationServer,
              registrationEndpoint: oauthMeta.registrationEndpoint,
              discoveredAt: new Date().toISOString(),
            }
          : null,
      })
      .returning({ id: schema.McpServer.id })
    if (!server) throw new Error('Failed to create McpServer')
    serverId = server.id

    const connectionType =
      mode === 'oauth' ? 'oauth2-code' : mode === 'bearer' || mode === 'headers' ? 'secret' : 'none'
    await db.insert(schema.ConnectionDefinition).values({
      mcpServerId: serverId,
      major: 1,
      connectionType,
      label: `${input.name} Connection`,
      global: true,
      createdById: input.createdById,
      oauth2AuthorizeUrl: input.oauth?.authorizeUrl ?? oauthMeta?.authorizeUrl ?? null,
      oauth2AccessTokenUrl: input.oauth?.tokenUrl ?? oauthMeta?.tokenUrl ?? null,
      oauth2Scopes: input.oauth?.scopes ?? oauthMeta?.scopesSupported ?? [],
      oauth2ClientId: encryptCred(input.oauth?.clientId ?? null),
      oauth2ClientSecret: encryptCred(input.oauth?.clientSecret ?? null),
      oauth2Features: { pkce: true },
    })
    await db.insert(schema.McpInstallation).values({
      organizationId: input.organizationId,
      mcpServerId: serverId,
    })
  }

  await onCacheEvent('mcp.server.changed', { orgId: input.organizationId })

  if (mode === 'none' || mode === 'bearer' || mode === 'headers') {
    if (mode === 'bearer' && input.token) {
      const saved = await saveMcpConnection({
        mcpServerId: serverId,
        serverName: input.name,
        organizationId: input.organizationId,
        createdById: input.createdById,
        connectionData: {
          secret: input.token,
          metadata: input.authHeaderName
            ? { authHeader: { name: input.authHeaderName } }
            : undefined,
        },
      })
      if (saved.isErr()) throw new Error(saved.error.message)
    }
    if (mode === 'headers' && input.headers?.length) {
      const saved = await saveMcpConnection({
        mcpServerId: serverId,
        serverName: input.name,
        organizationId: input.organizationId,
        createdById: input.createdById,
        connectionData: {
          headers: headerMap(input.headers),
          // Header NAMES are not secrets — kept in plaintext metadata so the edit
          // dialog can prefill rows (and getBySlug can derive the auth posture)
          // without decrypting.
          metadata: { headerNames: input.headers.map((h) => h.name) },
        },
      })
      if (saved.isErr()) throw new Error(saved.error.message)
    }
    await syncMcpTools({ mcpServerId: serverId, organizationId: input.organizationId })
    await onCacheEvent('mcp.connection.changed', { orgId: input.organizationId })
    return { connected: true, serverId, slug }
  }

  // OAuth: ensure client creds (pasted, kept from a prior attempt, or DCR).
  const outcome = await ensureOAuthClient({
    serverId,
    organizationId: input.organizationId,
    serverName: input.name,
    registrationEndpoint: oauthMeta?.registrationEndpoint,
    pastedClientId: input.oauth?.clientId,
    existingClientId,
    returnTo: input.returnTo,
  })
  return { ...outcome, serverId, slug }
}

/**
 * Connect a catalog template for an org: upsert the curated/global row from the template
 * definition (so new templates work in every environment without a re-seed), then run the
 * normal curated connect flow.
 */
export async function connectMcpTemplate(input: {
  organizationId: string
  createdById: string
  templateId: string
  connectionVariables?: Record<string, string>
  token?: string
  returnTo?: string
}): Promise<McpConnectOutcome & { serverId: string; slug: string }> {
  const template = mcpTemplates.find((t) => t.id === input.templateId)
  if (!template) throw new Error(`Unknown MCP template '${input.templateId}'`)
  // Non-DCR providers must go through the custom-server flow (org-owned server + pasted
  // OAuth app creds) — running the curated upsert here would only strand a global row.
  if (template.clientRegistration === 'manual') {
    throw new Error(
      `The ${template.name} template requires manual OAuth setup — save it from the template gallery and finish setup on its server page.`
    )
  }

  const { serverId } = await ensureCuratedMcpServer(template)
  await onCacheEvent('mcp.server.changed', { orgId: input.organizationId })

  const outcome = await connectCuratedMcpServer({
    organizationId: input.organizationId,
    createdById: input.createdById,
    serverId,
    connectionVariables: input.connectionVariables,
    token: input.token,
    returnTo: input.returnTo,
  })
  return { ...outcome, serverId, slug: template.id }
}

/**
 * Connect a curated (global) server for an org. Ensures an McpInstallation, then forks on the
 * curated definition's auth type. Curated OAuth defs may need lazy DCR on first connect; the
 * minted client creds are written back to the global definition (one Auxx client per provider).
 */
export async function connectCuratedMcpServer(input: {
  organizationId: string
  createdById: string
  serverId: string
  connectionVariables?: Record<string, string>
  token?: string
  returnTo?: string
}): Promise<McpConnectOutcome> {
  const server = await db.query.McpServer.findFirst({
    where: and(eq(schema.McpServer.id, input.serverId), isNull(schema.McpServer.organizationId)),
  })
  if (!server) throw new Error('Curated server not found')

  const def = await db.query.ConnectionDefinition.findFirst({
    where: eq(schema.ConnectionDefinition.mcpServerId, input.serverId),
  })
  if (!def) throw new Error('Connection definition not found')

  // Ensure an installation row for this org.
  const existing = await db.query.McpInstallation.findFirst({
    where: and(
      eq(schema.McpInstallation.organizationId, input.organizationId),
      eq(schema.McpInstallation.mcpServerId, input.serverId)
    ),
    columns: { id: true },
  })
  if (!existing) {
    await db.insert(schema.McpInstallation).values({
      organizationId: input.organizationId,
      mcpServerId: input.serverId,
    })
  }

  if (def.connectionType === 'none' || def.connectionType === 'secret') {
    // Persist a credential row whenever we have a secret OR connection variables (e.g.
    // Shopify's `shop` subdomain on a `none`-auth server — needed to interpolate the endpoint).
    const hasSecret = def.connectionType === 'secret' && !!input.token
    const hasVariables =
      !!input.connectionVariables && Object.keys(input.connectionVariables).length > 0
    if (hasSecret || hasVariables) {
      const saved = await saveMcpConnection({
        mcpServerId: input.serverId,
        serverName: server.name,
        organizationId: input.organizationId,
        createdById: input.createdById,
        connectionData: {
          secret: hasSecret ? input.token : undefined,
          metadata: hasVariables ? { connectionVariables: input.connectionVariables } : undefined,
        },
      })
      if (saved.isErr()) throw new Error(saved.error.message)
    }
    await syncMcpTools({ mcpServerId: input.serverId, organizationId: input.organizationId })
    await onCacheEvent('mcp.connection.changed', { orgId: input.organizationId })
    return { connected: true }
  }

  // OAuth — curated defs ship without authorize/token URLs (verified per-connect, not at seed
  // time). Discover them lazily, then DCR a client if the global def has none yet.
  const registrationEndpoint = await ensureCuratedOAuthProvisioned(input.serverId, server.endpoint)
  return ensureOAuthClient({
    serverId: input.serverId,
    organizationId: input.organizationId,
    serverName: server.name,
    registrationEndpoint,
    existingClientId: def.oauth2ClientId,
    returnTo: input.returnTo,
    connectionVariables: input.connectionVariables,
  })
}

/**
 * Ensure a curated OAuth server's global ConnectionDefinition has discovered authorize/token
 * URLs (RFC 9728/8414). Runs discovery on first connect, persisting the URLs onto the definition
 * and the DCR registration endpoint onto the McpServer. Returns the registration endpoint (if the
 * AS advertises one) for downstream lazy DCR.
 */
async function ensureCuratedOAuthProvisioned(
  serverId: string,
  endpoint: string
): Promise<string | undefined> {
  const def = await db.query.ConnectionDefinition.findFirst({
    where: eq(schema.ConnectionDefinition.mcpServerId, serverId),
    columns: { oauth2AuthorizeUrl: true, oauth2AccessTokenUrl: true },
  })
  const server = await db.query.McpServer.findFirst({
    where: eq(schema.McpServer.id, serverId),
    columns: { authDiscovery: true },
  })

  if (def?.oauth2AuthorizeUrl && def.oauth2AccessTokenUrl) {
    return server?.authDiscovery?.registrationEndpoint
  }

  const discovered = await discoverMcpAuth(endpoint)
  if (discovered.isErr() || discovered.value.kind !== 'oauth') {
    throw new Error(
      `OAuth discovery failed for curated server: ${
        discovered.isErr() ? discovered.error.message : 'server is not OAuth-protected'
      }`
    )
  }
  const oauth = discovered.value

  await db
    .update(schema.ConnectionDefinition)
    .set({
      oauth2AuthorizeUrl: oauth.authorizeUrl,
      oauth2AccessTokenUrl: oauth.tokenUrl,
      oauth2Scopes: oauth.scopesSupported ?? [],
    })
    .where(eq(schema.ConnectionDefinition.mcpServerId, serverId))
  await db
    .update(schema.McpServer)
    .set({
      authDiscovery: {
        authorizationServer: oauth.authorizationServer,
        registrationEndpoint: oauth.registrationEndpoint,
        discoveredAt: new Date().toISOString(),
      },
    })
    .where(eq(schema.McpServer.id, serverId))

  return oauth.registrationEndpoint
}

/** Ensure an OAuth client exists on the definition (pasted, already-present, or DCR-minted). */
async function ensureOAuthClient(input: {
  serverId: string
  organizationId: string
  serverName: string
  registrationEndpoint?: string
  pastedClientId?: string
  existingClientId?: string | null
  returnTo?: string
  connectionVariables?: Record<string, string>
}): Promise<McpConnectOutcome> {
  if (input.pastedClientId || input.existingClientId) {
    return { needsOAuth: true, authorizeUrl: authorizeUrlFor(input.serverId, input.returnTo) }
  }
  if (!input.registrationEndpoint) {
    return { needsClientCredentials: true }
  }
  const redirectUri = mcpRedirectUri(input.serverId)
  const dcr = await registerDcrClient({
    registrationEndpoint: input.registrationEndpoint,
    redirectUri,
    serverName: input.serverName,
  })
  if (dcr.isErr()) {
    logger.warn('DCR failed; falling back to pasted creds', { error: dcr.error.message })
    return { needsClientCredentials: true }
  }
  await db
    .update(schema.ConnectionDefinition)
    .set({
      oauth2ClientId: encryptCred(dcr.value.clientId),
      oauth2ClientSecret: encryptCred(dcr.value.clientSecret ?? null),
    })
    .where(eq(schema.ConnectionDefinition.mcpServerId, input.serverId))
  return { needsOAuth: true, authorizeUrl: authorizeUrlFor(input.serverId, input.returnTo) }
}

/**
 * Update an org-owned custom server (rename, endpoint, auth) and/or its trust config; busts the
 * cache. OAuth (re)connection stays on the detail page's reconnect button — `auth: 'oauth'` only
 * updates the definition's client creds / endpoint overrides. `auth: 'auto'` leaves the existing
 * connection untouched.
 */
export async function updateMcpServer(input: {
  organizationId: string
  serverId: string
  /** The acting user — used as `createdById` when a fresh credential row is inserted. */
  updatedById?: string
  name?: string
  endpoint?: string
  auth?: 'auto' | 'oauth' | 'bearer' | 'headers' | 'none'
  token?: string
  authHeaderName?: string
  /** Custom-header rows — full replace when provided; omit to keep the existing headers. */
  headers?: Array<{ name: string; value: string }>
  oauth?: McpOAuthConfigInput
  trust?: { allTools?: boolean; tools?: string[] }
}): Promise<void> {
  const serverPatch: { name?: string; endpoint?: string } = {}
  if (input.name) serverPatch.name = input.name
  if (input.endpoint) serverPatch.endpoint = input.endpoint
  if (Object.keys(serverPatch).length) {
    await db
      .update(schema.McpServer)
      .set(serverPatch)
      .where(
        and(
          eq(schema.McpServer.id, input.serverId),
          eq(schema.McpServer.organizationId, input.organizationId)
        )
      )
  }

  await applyAuthUpdate(input)

  if (
    input.endpoint ||
    input.auth === 'bearer' ||
    input.auth === 'headers' ||
    input.auth === 'none'
  ) {
    // Endpoint or credential changed → re-probe tools (best-effort; ignore failures).
    await syncMcpTools({ mcpServerId: input.serverId, organizationId: input.organizationId })
  }

  if (input.trust) {
    await db
      .update(schema.McpInstallation)
      .set({ trust: input.trust })
      .where(
        and(
          eq(schema.McpInstallation.mcpServerId, input.serverId),
          eq(schema.McpInstallation.organizationId, input.organizationId)
        )
      )
  }
  await onCacheEvent('mcp.tools.synced', { orgId: input.organizationId })
}

/** Apply an auth change on update: re-save (or clear) the org secret + definition type. */
async function applyAuthUpdate(input: {
  organizationId: string
  serverId: string
  updatedById?: string
  auth?: 'auto' | 'oauth' | 'bearer' | 'headers' | 'none'
  token?: string
  authHeaderName?: string
  headers?: Array<{ name: string; value: string }>
  oauth?: McpOAuthConfigInput
}): Promise<void> {
  if (!input.auth || input.auth === 'auto') return

  if (input.auth === 'oauth') {
    // Definition-only: client creds / endpoint overrides. Reconnecting (the popup) stays on the
    // detail page — provided fields update, omitted fields keep their (possibly DCR-minted) values.
    await db
      .update(schema.ConnectionDefinition)
      .set({
        connectionType: 'oauth2-code',
        ...(input.oauth?.clientId !== undefined && {
          oauth2ClientId: encryptCred(input.oauth.clientId),
        }),
        // Blank/omitted secret keeps the stored (possibly DCR-minted) one; so does a
        // masked-prefill echo (HIDDEN_VALUE or mask-shaped) — never persist the mask.
        ...(input.oauth?.clientSecret !== undefined &&
          !isMaskEcho(input.oauth.clientSecret) && {
            oauth2ClientSecret: encryptCred(input.oauth.clientSecret),
          }),
        ...(input.oauth?.authorizeUrl !== undefined && {
          oauth2AuthorizeUrl: input.oauth.authorizeUrl,
        }),
        ...(input.oauth?.tokenUrl !== undefined && {
          oauth2AccessTokenUrl: input.oauth.tokenUrl,
        }),
        ...(input.oauth?.scopes !== undefined && { oauth2Scopes: input.oauth.scopes }),
      })
      .where(eq(schema.ConnectionDefinition.mcpServerId, input.serverId))
    return
  }

  if (input.auth === 'none') {
    await db
      .update(schema.ConnectionDefinition)
      .set({ connectionType: 'none' })
      .where(eq(schema.ConnectionDefinition.mcpServerId, input.serverId))
    await deleteMcpConnection({ mcpServerId: input.serverId, organizationId: input.organizationId })
    await onCacheEvent('mcp.connection.changed', { orgId: input.organizationId })
    return
  }

  // bearer/headers — only re-save when new secret material was supplied (blank keeps existing).
  await db
    .update(schema.ConnectionDefinition)
    .set({ connectionType: 'secret' })
    .where(eq(schema.ConnectionDefinition.mcpServerId, input.serverId))
  const connectionData =
    input.auth === 'bearer'
      ? input.token
        ? {
            secret: input.token,
            metadata: input.authHeaderName
              ? { authHeader: { name: input.authHeaderName } }
              : undefined,
          }
        : null
      : input.headers?.length
        ? {
            headers: headerMap(input.headers),
            metadata: { headerNames: input.headers.map((h) => h.name) },
          }
        : null
  if (!connectionData) return

  const existing = await findCredential({
    kind: 'mcp',
    mcpServerId: input.serverId,
    organizationId: input.organizationId,
    userId: null,
  })
  const existingId = existing.isOk() ? existing.value?.id : undefined
  const server = await db.query.McpServer.findFirst({
    where: eq(schema.McpServer.id, input.serverId),
    columns: { name: true, createdById: true },
  })
  const saved = await saveMcpConnection({
    mcpServerId: input.serverId,
    serverName: server?.name ?? 'MCP',
    organizationId: input.organizationId,
    createdById: input.updatedById ?? server?.createdById ?? '',
    connectionData,
    connectionId: existingId,
  })
  if (saved.isErr()) throw new Error(saved.error.message)
  await onCacheEvent('mcp.connection.changed', { orgId: input.organizationId })
}

/** Disconnect/remove: delete the credential + installation; org-owned custom servers cascade. */
export async function deleteMcpServer(input: {
  organizationId: string
  serverId: string
}): Promise<void> {
  await deleteMcpConnection({ mcpServerId: input.serverId, organizationId: input.organizationId })
  await db
    .delete(schema.McpInstallation)
    .where(
      and(
        eq(schema.McpInstallation.mcpServerId, input.serverId),
        eq(schema.McpInstallation.organizationId, input.organizationId)
      )
    )
  // Org-owned custom server → delete the McpServer (cascades its definition).
  await db
    .delete(schema.McpServer)
    .where(
      and(
        eq(schema.McpServer.id, input.serverId),
        eq(schema.McpServer.organizationId, input.organizationId)
      )
    )
  await onCacheEvent('mcp.server.changed', { orgId: input.organizationId })
}
