// apps/web/src/server/api/routers/mcp.ts

import { decryptValue, maskValue } from '@auxx/credentials/crypto'
import { findCredential } from '@auxx/credentials/store'
import type { ConnectionVariable } from '@auxx/database'
import { database as db, schema } from '@auxx/database'
import {
  checkMcpResolveRateLimit,
  connectCuratedMcpServer,
  connectMcpTemplate,
  createCustomMcpServer,
  deleteMcpServer,
  mcpRedirectUri,
  mcpTemplateCategories,
  mcpTemplates,
  resolveMcpSnippet,
  syncMcpTools,
  testMcpTool,
  updateMcpServer,
  updateMcpToolSchema,
} from '@auxx/lib/ai/mcp'
import { buildCreateOAuthAppUrl } from '@auxx/lib/ai/mcp/templates/client'
import { getOrgCache } from '@auxx/lib/cache'
import { RateLimitError } from '@auxx/lib/errors'
import { isAdminOrOwner } from '@auxx/lib/members'
import { FeaturePermissionService, PermissionKey } from '@auxx/lib/permissions'
import { FeatureKey } from '@auxx/lib/permissions/client'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { createTRPCRouter, permissionProcedure, protectedProcedure } from '../trpc'

const logger = createScopedLogger('mcp-router')

/** integrations capability + the `mcp` feature gate — guards every MCP mutation. */
const mcpAdminProcedure = permissionProcedure(PermissionKey.integrationsManage).use(
  async ({ ctx, next }) => {
    await new FeaturePermissionService().requireAccess(ctx.session.organizationId, FeatureKey.mcp)
    return next()
  }
)

/**
 * Fetch the connection-definition data the detail page + edit dialog need: connection-variable
 * defs (curated connect dialog) and the OAuth config prefill. Only the MASK of the client
 * secret leaves the server, and only for admins — the edit dialog is admin-only, so members
 * (read-only viewers) get null.
 */
async function getConnectionDefinitionInfo(
  serverId: string,
  includeSecretMask: boolean
): Promise<{
  connectionVariables: ConnectionVariable[]
  oauth: {
    clientId: string | null
    clientSecret: string | null
    authorizeUrl: string | null
    tokenUrl: string | null
    scopes: string[]
  } | null
}> {
  const def = await db.query.ConnectionDefinition.findFirst({
    where: eq(schema.ConnectionDefinition.mcpServerId, serverId),
    columns: {
      connectionVariables: true,
      oauth2ClientId: true,
      oauth2ClientSecret: true,
      oauth2AuthorizeUrl: true,
      oauth2AccessTokenUrl: true,
      oauth2Scopes: true,
    },
  })
  const secret = includeSecretMask ? decryptValue(def?.oauth2ClientSecret ?? null) : null
  return {
    connectionVariables: def?.connectionVariables ?? [],
    oauth: def
      ? {
          clientId: decryptValue(def.oauth2ClientId),
          clientSecret: secret ? maskValue(secret) : null,
          authorizeUrl: def.oauth2AuthorizeUrl,
          tokenUrl: def.oauth2AccessTokenUrl,
          scopes: def.oauth2Scopes ?? [],
        }
      : null,
  }
}

/**
 * Setup guidance for custom servers created from a `clientRegistration: 'manual'` template,
 * matched by endpoint (custom servers carry no template FK). The provider's "create OAuth app"
 * link gets the callback URL interpolated into its catalog-authored placeholders.
 */
function getTemplateSetup(endpoint: string | null, redirectUri: string | null) {
  if (!endpoint) return null
  const template = mcpTemplates.find(
    (t) => t.clientRegistration === 'manual' && t.endpoint === endpoint
  )
  if (!template) return null
  return {
    setupHint: template.setupHint ?? null,
    createOAuthAppUrl:
      template.createOAuthAppUrl && redirectUri
        ? buildCreateOAuthAppUrl(template.createOAuthAppUrl, redirectUri)
        : (template.createOAuthAppUrl ?? null),
    docsUrl: template.docsUrl ?? null,
    clientSecretRequired: template.clientSecretRequired ?? false,
  }
}

/** Fetch the raw endpoint (shown on the detail page's About tab for custom servers). */
async function getServerEndpoint(serverId: string): Promise<string | null> {
  const server = await db.query.McpServer.findFirst({
    where: eq(schema.McpServer.id, serverId),
    columns: { endpoint: true },
  })
  return server?.endpoint ?? null
}

/**
 * Derive the edit dialog's auth posture + prefill data from the credential's plaintext metadata
 * (no decryption). `connectionType` alone can't distinguish bearer from custom headers — both
 * store as `'secret'`; headers-auth connections carry their header NAMES in metadata.
 */
async function getAuthPosture(
  serverId: string,
  organizationId: string,
  connectionType: 'oauth2-code' | 'secret' | 'none' | null
): Promise<{
  authPosture: 'oauth' | 'bearer' | 'headers' | 'none' | null
  authHeaderName: string | null
  headerNames: string[]
}> {
  if (connectionType === 'oauth2-code') {
    return { authPosture: 'oauth', authHeaderName: null, headerNames: [] }
  }
  if (connectionType === 'none') {
    return { authPosture: 'none', authHeaderName: null, headerNames: [] }
  }
  if (connectionType !== 'secret') {
    return { authPosture: null, authHeaderName: null, headerNames: [] }
  }
  const credential = await findCredential({
    organizationId,
    kind: 'mcp',
    mcpServerId: serverId,
    userId: null,
  })
  const metadata = credential.isOk() ? (credential.value?.metadata ?? {}) : {}
  const headerNames = Array.isArray(metadata.headerNames) ? (metadata.headerNames as string[]) : []
  const authHeaderName = (metadata.authHeader as { name?: string } | undefined)?.name ?? null
  return {
    authPosture: headerNames.length > 0 ? 'headers' : 'bearer',
    authHeaderName,
    headerNames,
  }
}

/**
 * MCP server management. Reads are `protectedProcedure` (members see connected servers
 * read-only, gated to `[]`/null when the `mcp` feature is off); mutations are
 * `mcpAdminProcedure` (admin + feature gate). Orchestration lives in `@auxx/lib/ai/mcp`.
 */
export const mcpRouter = createTRPCRouter({
  /**
   * All MCP servers visible to the org (curated + custom), straight from the org cache.
   * Returns `[]` (not a throw) when the feature is off so the Apps page + catalog merge
   * degrade gracefully.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    const hasAccess = await new FeaturePermissionService().hasAccess(
      ctx.session.organizationId,
      FeatureKey.mcp
    )
    if (!hasAccess) return []
    return getOrgCache().get(ctx.session.organizationId, 'mcpServers')
  }),

  /** Single server with full detail for the settings detail page. */
  getBySlug: protectedProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ ctx, input }) => {
      const hasAccess = await new FeaturePermissionService().hasAccess(
        ctx.session.organizationId,
        FeatureKey.mcp
      )
      if (!hasAccess) return null
      const servers = await getOrgCache().get(ctx.session.organizationId, 'mcpServers')
      const server = servers.find((s) => s.slug === input.slug)
      if (!server) return null
      const [defInfo, endpoint, posture] = await Promise.all([
        // Scope/visibility selection: determining what connection definition info to return (plan 21 §5.2).
        isAdminOrOwner(ctx.session.organizationId, ctx.session.userId).then((isAdmin) =>
          getConnectionDefinitionInfo(server.serverId, isAdmin)
        ),
        getServerEndpoint(server.serverId),
        getAuthPosture(server.serverId, ctx.session.organizationId, server.connectionType),
      ])
      // Computed server-side: CALLBACK_BASE can be an ngrok URL the browser can't derive.
      const redirectUri =
        server.isCustom && server.connectionType === 'oauth2-code'
          ? mcpRedirectUri(server.serverId)
          : null
      const templateSetup = getTemplateSetup(endpoint, redirectUri)
      return { ...server, ...defInfo, endpoint, ...posture, redirectUri, templateSetup }
    }),

  /**
   * Static template catalog from `@auxx/lib/ai/mcp` — the "Connect from template" dialog's data
   * source (the catalog never ships in the client bundle). Mirrors `list`'s gate-to-empty shape.
   */
  listTemplates: protectedProcedure.query(async ({ ctx }) => {
    const hasAccess = await new FeaturePermissionService().hasAccess(
      ctx.session.organizationId,
      FeatureKey.mcp
    )
    if (!hasAccess) return { templates: [], categories: [] }
    return { templates: mcpTemplates, categories: mcpTemplateCategories }
  }),

  /**
   * Connect a catalog template: upserts the curated/global row from the lib definition, then
   * runs the curated connect flow.
   */
  connectTemplate: mcpAdminProcedure
    .input(
      z.object({
        templateId: z.string(),
        connectionVariables: z.record(z.string(), z.string()).optional(),
        token: z.string().optional(),
        returnTo: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return connectMcpTemplate({
        organizationId: ctx.session.organizationId,
        createdById: ctx.session.user.id,
        ...input,
      })
    }),

  /**
   * Smart paste: resolve any pasted snippet (URL / JSON / TOML / CLI / deeplink / stdio config)
   * into connectable remote candidates. Rate-limited per org — makes outbound fetches to
   * user-controlled URLs. All logic lives in `@auxx/lib/ai/mcp`.
   */
  resolveSnippet: mcpAdminProcedure
    .input(z.object({ snippet: z.string().min(1).max(10_000) }))
    .mutation(async ({ ctx, input }) => {
      const allowed = await checkMcpResolveRateLimit(ctx.session.organizationId)
      if (!allowed) {
        throw new RateLimitError('Too many resolve attempts. Wait a minute and try again.')
      }
      return resolveMcpSnippet(input.snippet)
    }),

  /** Create a custom server from a pasted URL. */
  create: mcpAdminProcedure
    .input(
      z.object({
        name: z.string().min(1).max(120),
        endpoint: z.string().url(),
        auth: z.enum(['auto', 'oauth', 'bearer', 'headers', 'none']),
        token: z.string().optional(),
        authHeaderName: z.string().optional(),
        headers: z
          .array(z.object({ name: z.string().min(1), value: z.string().min(1) }))
          .optional(),
        oauth: z
          .object({
            clientId: z.string().optional(),
            clientSecret: z.string().optional(),
            authorizeUrl: z.string().url().optional(),
            tokenUrl: z.string().url().optional(),
            scopes: z.array(z.string()).optional(),
          })
          .optional(),
        description: z.string().optional(),
        icon: z
          .object({
            avatarAssetId: z.string().optional(),
            color: z.string().optional(),
            iconId: z.string().optional(),
          })
          .optional(),
        returnTo: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return createCustomMcpServer({
        organizationId: ctx.session.organizationId,
        createdById: ctx.session.user.id,
        ...input,
      })
    }),

  /** Connect a curated (global) server for the org. */
  connect: mcpAdminProcedure
    .input(
      z.object({
        serverId: z.string(),
        connectionVariables: z.record(z.string(), z.string()).optional(),
        token: z.string().optional(),
        returnTo: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return connectCuratedMcpServer({
        organizationId: ctx.session.organizationId,
        createdById: ctx.session.user.id,
        ...input,
      })
    }),

  /** Re-snapshot a server's tools. */
  refreshTools: mcpAdminProcedure
    .input(z.object({ serverId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const result = await syncMcpTools({
        mcpServerId: input.serverId,
        organizationId: ctx.session.organizationId,
      })
      if (!result.ok) {
        logger.warn('Manual refresh failed', { serverId: input.serverId, error: result.error })
      }
      return result
    }),

  /**
   * Test-run a single tool with admin-supplied args. All tools are allowed (write tools carry an
   * inline caution in the UI); the org-minute rate ceiling still applies. Returns the raw result
   * plus an inferred schema for the "Generate from result" editor.
   */
  testTool: mcpAdminProcedure
    .input(
      z.object({
        serverId: z.string(),
        toolName: z.string(),
        args: z.record(z.string(), z.unknown()).default({}),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return testMcpTool({
        organizationId: ctx.session.organizationId,
        userId: ctx.session.user.id,
        serverId: input.serverId,
        toolName: input.toolName,
        args: input.args,
      })
    }),

  /**
   * Persist a tool's output schema / example on the org's installation. `outputSchema: null`
   * resets to none (un-sticks a manual schema); `clearExampleOutput` removes the stored example.
   */
  updateToolSchema: mcpAdminProcedure
    .input(
      z.object({
        serverId: z.string(),
        toolName: z.string(),
        outputSchema: z.record(z.string(), z.unknown()).nullish(),
        source: z.enum(['inferred', 'manual']).optional(),
        exampleOutput: z.unknown().optional(),
        clearExampleOutput: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return updateMcpToolSchema({
        organizationId: ctx.session.organizationId,
        serverId: input.serverId,
        toolName: input.toolName,
        outputSchema: input.outputSchema,
        source: input.source,
        exampleOutput: input.exampleOutput,
        clearExampleOutput: input.clearExampleOutput,
      })
    }),

  /** Edit a custom server (name / endpoint / auth) and/or update trust config. */
  update: mcpAdminProcedure
    .input(
      z.object({
        serverId: z.string(),
        name: z.string().min(1).max(120).optional(),
        endpoint: z.string().url().optional(),
        auth: z.enum(['auto', 'oauth', 'bearer', 'headers', 'none']).optional(),
        token: z.string().optional(),
        authHeaderName: z.string().optional(),
        headers: z
          .array(z.object({ name: z.string().min(1), value: z.string().min(1) }))
          .optional(),
        oauth: z
          .object({
            clientId: z.string().optional(),
            clientSecret: z.string().optional(),
            authorizeUrl: z.string().url().optional(),
            tokenUrl: z.string().url().optional(),
            scopes: z.array(z.string()).optional(),
          })
          .optional(),
        trust: z
          .object({ allTools: z.boolean().optional(), tools: z.array(z.string()).optional() })
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await updateMcpServer({
        organizationId: ctx.session.organizationId,
        updatedById: ctx.session.user.id,
        ...input,
      })
      return { ok: true }
    }),

  /** Disconnect / remove a server. */
  delete: mcpAdminProcedure
    .input(z.object({ serverId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await deleteMcpServer({
        organizationId: ctx.session.organizationId,
        serverId: input.serverId,
      })
      return { ok: true }
    }),
})
