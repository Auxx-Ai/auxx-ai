// apps/web/src/server/api/routers/agent.ts

import {
  agentExistsInOrg,
  createAgent as createAgentService,
  getAgentDetailByIdOrSlug,
  isAgentSlugTaken,
  listAgents,
  updateAgent as updateAgentService,
} from '@auxx/lib/agents'
import { createScopedLogger } from '@auxx/logger'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { adminProcedure, createTRPCRouter } from '../trpc'

const logger = createScopedLogger('agent-router')

const promptSchema = z.record(z.string(), z.unknown())

/**
 * Admin-only CRUD for user-authored Kopilot agents. Toolset rows are managed
 * via the sibling `agentToolset.*` router. Archive is driven through `update`
 * (`archivedAt: Date | null`) per plans/kopilot/agents/phase-1-engine-and-api.md
 * §3.2. Reads flow through the org agents cache; writes go through
 * `@auxx/lib/agents` service functions — no raw SQL lives in this router.
 */
export const agentRouter = createTRPCRouter({
  list: adminProcedure
    .input(z.object({ includeArchived: z.boolean().optional() }).optional())
    .query(({ ctx, input }) =>
      listAgents(ctx.session.organizationId, {
        includeArchived: input?.includeArchived ?? false,
      })
    ),

  /**
   * Resolve an agent by id or slug. The input field is named `agentId` for
   * backward compatibility with existing callers, but accepts either form —
   * the service helper checks both columns against the org agents cache.
   */
  getById: adminProcedure
    .input(z.object({ agentId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const detail = await getAgentDetailByIdOrSlug(ctx.session.organizationId, input.agentId)
      if (!detail) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' })
      }
      return detail
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
         * Initial toolset slugs to enable. When omitted, `createAgent`
         * resolves defaults and tags the rows `source='auto_default'`. When
         * provided, every slug lands as `source='manual'`.
         */
        toolsetSlugs: z.array(z.string().min(1).max(120)).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session

      if (await isAgentSlugTaken(organizationId, input.slug)) {
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
        toolsetSlugs: input.toolsetSlugs,
      })

      logger.info('Agent created', {
        organizationId,
        agentId: created.agentId,
        toolsetCount: created.toolsetSlugs.length,
        source: created.toolsetSource,
      })

      return { agentId: created.agentId, userId: created.userId }
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

      if (!(await agentExistsInOrg(organizationId, agentId))) {
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
      const taken = await isAgentSlugTaken(ctx.session.organizationId, input.slug, {
        excludeAgentId: input.excludeAgentId,
      })
      return { available: !taken }
    }),
})
