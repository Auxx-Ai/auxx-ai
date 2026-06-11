// apps/web/src/server/api/routers/mcp.ts

import type { ConnectionVariable } from '@auxx/database'
import { database as db, schema } from '@auxx/database'
import {
  checkMcpResolveRateLimit,
  connectCuratedMcpServer,
  createCustomMcpServer,
  deleteMcpServer,
  resolveMcpSnippet,
  syncMcpTools,
  updateMcpServer,
} from '@auxx/lib/ai/mcp'
import { getOrgCache } from '@auxx/lib/cache'
import { RateLimitError } from '@auxx/lib/errors'
import { FeaturePermissionService } from '@auxx/lib/permissions'
import { FeatureKey } from '@auxx/lib/permissions/client'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { adminProcedure, createTRPCRouter, protectedProcedure } from '../trpc'

const logger = createScopedLogger('mcp-router')

/** adminProcedure + the `mcp` feature gate — guards every MCP mutation. */
const mcpAdminProcedure = adminProcedure.use(async ({ ctx, next }) => {
  await new FeaturePermissionService().requireAccess(ctx.session.organizationId, FeatureKey.mcp)
  return next()
})

/** Fetch the connection-variable defs (for the curated connect dialog) for a server. */
async function getConnectionVariables(serverId: string): Promise<ConnectionVariable[]> {
  const def = await db.query.ConnectionDefinition.findFirst({
    where: eq(schema.ConnectionDefinition.mcpServerId, serverId),
    columns: { oauth2Features: true },
  })
  return def?.oauth2Features?.connectionVariables ?? []
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
      const [connectionVariables, endpoint] = await Promise.all([
        getConnectionVariables(server.serverId),
        getServerEndpoint(server.serverId),
      ])
      return { ...server, connectionVariables, endpoint }
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
        auth: z.enum(['auto', 'bearer', 'none']),
        token: z.string().optional(),
        authHeaderName: z.string().optional(),
        description: z.string().optional(),
        icon: z
          .object({
            avatarAssetId: z.string().optional(),
            color: z.string().optional(),
            iconId: z.string().optional(),
          })
          .optional(),
        clientId: z.string().optional(),
        clientSecret: z.string().optional(),
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

  /** Edit a custom server (name / endpoint / bearer auth) and/or update trust config. */
  update: mcpAdminProcedure
    .input(
      z.object({
        serverId: z.string(),
        name: z.string().min(1).max(120).optional(),
        endpoint: z.string().url().optional(),
        auth: z.enum(['auto', 'bearer', 'none']).optional(),
        token: z.string().optional(),
        authHeaderName: z.string().optional(),
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
