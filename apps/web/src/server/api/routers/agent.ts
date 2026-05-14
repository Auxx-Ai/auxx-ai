// apps/web/src/server/api/routers/agent.ts

import { schema } from '@auxx/database'
import {
  createAgent as createAgentService,
  resolveDefaultToolsets,
  updateAgent as updateAgentService,
} from '@auxx/lib/agents'
import { createScopedLogger } from '@auxx/logger'
import { TRPCError } from '@trpc/server'
import { and, eq, ne } from 'drizzle-orm'
import { z } from 'zod'
import { adminProcedure, createTRPCRouter } from '../trpc'

const logger = createScopedLogger('agent-router')

const promptSchema = z.record(z.string(), z.unknown())

/**
 * Admin-only CRUD for user-authored Kopilot agents. Toolset rows are managed
 * via the sibling `agentToolset.*` router. Archive is driven through `update`
 * (`archivedAt: Date | null`) per plans/kopilot/agents/phase-1-engine-and-api.md
 * §3.2.
 */
export const agentRouter = createTRPCRouter({
  list: adminProcedure
    .input(z.object({ includeArchived: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const includeArchived = input?.includeArchived ?? false

      // getCachedAgents already filters out archivedAt; bypass for archived
      // visibility by reading the raw cache key.
      const all = await ctx.db
        .select({
          id: schema.Agent.id,
          userId: schema.Agent.userId,
          name: schema.User.name,
          slug: schema.Agent.slug,
          description: schema.Agent.description,
          avatarAssetId: schema.User.avatarAssetId,
          mentionable: schema.Agent.mentionable,
          modelId: schema.Agent.modelId,
          archivedAt: schema.Agent.archivedAt,
          createdAt: schema.Agent.createdAt,
          updatedAt: schema.Agent.updatedAt,
        })
        .from(schema.Agent)
        .innerJoin(schema.User, eq(schema.User.id, schema.Agent.userId))
        .where(eq(schema.Agent.organizationId, organizationId))

      const rows = includeArchived ? all : all.filter((r) => !r.archivedAt)
      return rows.map((r) => ({
        ...r,
        archivedAt: r.archivedAt ? r.archivedAt.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      }))
    }),

  getById: adminProcedure.input(z.object({ agentId: z.string() })).query(async ({ ctx, input }) => {
    const { organizationId } = ctx.session

    const [row] = await ctx.db
      .select({
        agent: schema.Agent,
        userName: schema.User.name,
        avatarAssetId: schema.User.avatarAssetId,
      })
      .from(schema.Agent)
      .innerJoin(schema.User, eq(schema.User.id, schema.Agent.userId))
      .where(
        and(eq(schema.Agent.id, input.agentId), eq(schema.Agent.organizationId, organizationId))
      )
      .limit(1)

    if (!row) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' })
    }

    const { agent } = row

    const toolsets = await ctx.db
      .select()
      .from(schema.AgentToolset)
      .where(eq(schema.AgentToolset.agentId, agent.id))

    const resourceScopes = await ctx.db
      .select()
      .from(schema.AgentResourceScope)
      .where(eq(schema.AgentResourceScope.agentId, agent.id))

    return {
      id: agent.id,
      organizationId: agent.organizationId,
      userId: agent.userId,
      createdById: agent.createdById,
      name: row.userName,
      slug: agent.slug,
      description: agent.description,
      avatarAssetId: row.avatarAssetId,
      prompt: agent.prompt,
      pinnedRecords: agent.pinnedRecords,
      mentionable: agent.mentionable,
      modelId: agent.modelId,
      archivedAt: agent.archivedAt ? agent.archivedAt.toISOString() : null,
      createdAt: agent.createdAt.toISOString(),
      updatedAt: agent.updatedAt.toISOString(),
      toolsets: toolsets.map((t) => ({
        id: t.id,
        slug: t.toolsetSlug,
        appInstallationId: t.appInstallationId,
        config: t.config,
        source: t.source,
        enabled: t.enabled,
      })),
      resourceScopes,
    }
  }),

  create: adminProcedure
    .input(
      z.object({
        name: z.string().min(1).max(120),
        slug: z
          .string()
          .min(1)
          .max(60)
          .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, digits, and dashes'),
        description: z.string().max(500).optional().nullable(),
        prompt: promptSchema.optional(),
        modelId: z.string().max(120).optional().nullable(),
        mentionable: z.boolean().optional(),
        /**
         * Initial toolset slugs to enable. When omitted, defaults to
         * `resolveDefaultToolsets(orgId)` and rows are tagged
         * `source='auto_default'`. When provided, caller-supplied slugs are
         * tagged `source='manual'`.
         */
        toolsetSlugs: z.array(z.string().min(1).max(120)).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session

      const [conflict] = await ctx.db
        .select({ id: schema.Agent.id })
        .from(schema.Agent)
        .where(
          and(eq(schema.Agent.organizationId, organizationId), eq(schema.Agent.slug, input.slug))
        )
        .limit(1)
      if (conflict) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Slug already in use' })
      }

      const created = await createAgentService({
        organizationId,
        createdById: userId,
        name: input.name,
        slug: input.slug,
        description: input.description ?? null,
        prompt: input.prompt,
        modelId: input.modelId ?? null,
        mentionable: input.mentionable ?? true,
      })

      const slugs = input.toolsetSlugs ?? (await resolveDefaultToolsets(organizationId))
      const source: 'manual' | 'auto_default' = input.toolsetSlugs ? 'manual' : 'auto_default'
      const now = new Date()

      if (slugs.length > 0) {
        await ctx.db.insert(schema.AgentToolset).values(
          slugs.map((slug) => ({
            agentId: created.agentId,
            toolsetSlug: slug,
            source,
            enabled: true,
            config: {},
            updatedAt: now,
          }))
        )
      }

      logger.info('Agent created', {
        organizationId,
        agentId: created.agentId,
        toolsetCount: slugs.length,
        source,
      })

      return created
    }),

  update: adminProcedure
    .input(
      z.object({
        agentId: z.string(),
        name: z.string().min(1).max(120).optional(),
        description: z.string().max(500).optional().nullable(),
        prompt: promptSchema.optional(),
        modelId: z.string().max(120).optional().nullable(),
        mentionable: z.boolean().optional(),
        /** Date archives; null unarchives; omit to leave unchanged. */
        archivedAt: z.date().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const { agentId, ...patch } = input

      const [existing] = await ctx.db
        .select({ id: schema.Agent.id })
        .from(schema.Agent)
        .where(and(eq(schema.Agent.id, agentId), eq(schema.Agent.organizationId, organizationId)))
        .limit(1)
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' })
      }

      const updatePayload: Parameters<typeof updateAgentService>[2] = {}
      if (patch.name !== undefined) updatePayload.name = patch.name
      if (patch.description !== undefined) updatePayload.description = patch.description
      if (patch.prompt !== undefined) updatePayload.prompt = patch.prompt
      if (patch.modelId !== undefined) updatePayload.modelId = patch.modelId
      if (patch.mentionable !== undefined) updatePayload.mentionable = patch.mentionable
      if (patch.archivedAt !== undefined) updatePayload.archivedAt = patch.archivedAt

      await updateAgentService(agentId, organizationId, updatePayload)
    }),

  checkSlug: adminProcedure
    .input(z.object({ slug: z.string().min(1).max(60), excludeAgentId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const conditions = [
        eq(schema.Agent.organizationId, organizationId),
        eq(schema.Agent.slug, input.slug),
      ]
      if (input.excludeAgentId) {
        conditions.push(ne(schema.Agent.id, input.excludeAgentId))
      }
      const [row] = await ctx.db
        .select({ id: schema.Agent.id })
        .from(schema.Agent)
        .where(and(...conditions))
        .limit(1)

      return { available: !row }
    }),
})
