// apps/web/src/server/api/routers/agent-toolset.ts

import { schema } from '@auxx/database'
import type { AgentToolsetConfig } from '@auxx/lib/agents'
import { onCacheEvent } from '@auxx/lib/cache'
import { createScopedLogger } from '@auxx/logger'
import { TRPCError } from '@trpc/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { adminProcedure, createTRPCRouter } from '../trpc'

const logger = createScopedLogger('agent-toolset-router')

const toolsetPatchSchema = z.object({
  slug: z.string().min(1).max(120),
  enabled: z.boolean().optional(),
  disabledTools: z.array(z.string().min(1).max(120)).optional(),
})

async function applyToolsetPatch(
  // biome-ignore lint/suspicious/noExplicitAny: drizzle tx
  tx: any,
  agentId: string,
  patch: z.infer<typeof toolsetPatchSchema>
) {
  const now = new Date()

  const [existing] = await tx
    .select({
      id: schema.AgentToolset.id,
      config: schema.AgentToolset.config,
      source: schema.AgentToolset.source,
    })
    .from(schema.AgentToolset)
    .where(
      and(eq(schema.AgentToolset.agentId, agentId), eq(schema.AgentToolset.toolsetSlug, patch.slug))
    )
    .limit(1)

  if (existing) {
    const nextConfig: AgentToolsetConfig = { ...(existing.config as AgentToolsetConfig) }
    if (patch.disabledTools !== undefined) {
      nextConfig.disabledTools = patch.disabledTools
    }
    const update: Record<string, unknown> = {
      updatedAt: now,
      config: nextConfig,
    }
    if (patch.enabled !== undefined) update.enabled = patch.enabled
    // First-touch promotion: auto_default rows become 'manual' once an admin
    // actively saves them.
    if (existing.source === 'auto_default') update.source = 'manual'
    await tx.update(schema.AgentToolset).set(update).where(eq(schema.AgentToolset.id, existing.id))
    return
  }

  const config: AgentToolsetConfig = {}
  if (patch.disabledTools !== undefined) config.disabledTools = patch.disabledTools
  await tx.insert(schema.AgentToolset).values({
    agentId,
    toolsetSlug: patch.slug,
    config,
    source: 'manual',
    enabled: patch.enabled ?? true,
    updatedAt: now,
  })
}

/**
 * Per-agent toolset CRUD. Mention-sourced rows (`source='mention'`) are
 * managed by the prompt reconciler and not mutable through this router; this
 * router writes `manual` (or promotes `auto_default` → `manual`).
 */
export const agentToolsetRouter = createTRPCRouter({
  list: adminProcedure.input(z.object({ agentId: z.string() })).query(async ({ ctx, input }) => {
    const { organizationId } = ctx.session

    const [agent] = await ctx.db
      .select({ id: schema.Agent.id })
      .from(schema.Agent)
      .where(
        and(eq(schema.Agent.id, input.agentId), eq(schema.Agent.organizationId, organizationId))
      )
      .limit(1)
    if (!agent) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' })
    }

    return ctx.db
      .select()
      .from(schema.AgentToolset)
      .where(eq(schema.AgentToolset.agentId, input.agentId))
  }),

  update: adminProcedure
    .input(
      toolsetPatchSchema.extend({
        agentId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      const [agent] = await ctx.db
        .select({ id: schema.Agent.id })
        .from(schema.Agent)
        .where(
          and(eq(schema.Agent.id, input.agentId), eq(schema.Agent.organizationId, organizationId))
        )
        .limit(1)
      if (!agent) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' })
      }

      await ctx.db.transaction(async (tx) => {
        await applyToolsetPatch(tx, input.agentId, {
          slug: input.slug,
          enabled: input.enabled,
          disabledTools: input.disabledTools,
        })
      })

      await onCacheEvent('agent.updated', { orgId: organizationId })
      logger.info('Agent toolset updated', {
        organizationId,
        agentId: input.agentId,
        slug: input.slug,
      })
    }),

  batchUpdate: adminProcedure
    .input(
      z.object({
        agentId: z.string(),
        toolsets: z.array(toolsetPatchSchema).min(1).max(200),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      const [agent] = await ctx.db
        .select({ id: schema.Agent.id })
        .from(schema.Agent)
        .where(
          and(eq(schema.Agent.id, input.agentId), eq(schema.Agent.organizationId, organizationId))
        )
        .limit(1)
      if (!agent) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' })
      }

      await ctx.db.transaction(async (tx) => {
        for (const patch of input.toolsets) {
          await applyToolsetPatch(tx, input.agentId, patch)
        }
      })

      await onCacheEvent('agent.updated', { orgId: organizationId })
      logger.info('Agent toolsets batch-updated', {
        organizationId,
        agentId: input.agentId,
        count: input.toolsets.length,
      })
    }),
})
