// apps/web/src/server/api/routers/agent-toolset.ts

import {
  agentExistsInOrg,
  batchUpdateAgentToolsets,
  getOrgToolsetCatalog,
  updateAgentToolset,
} from '@auxx/lib/agents'
import { createScopedLogger } from '@auxx/logger'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { adminProcedure, createTRPCRouter } from '../trpc'

const logger = createScopedLogger('agent-toolset-router')

const toolsetPatchSchema = z.object({
  slug: z.string().min(1).max(120),
  enabled: z.boolean().optional(),
  disabledTools: z.array(z.string().min(1).max(120)).optional(),
})

async function ensureAgentInOrg(organizationId: string, agentId: string): Promise<void> {
  if (!(await agentExistsInOrg(organizationId, agentId))) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' })
  }
}

/**
 * Per-agent toolset CRUD. Mention-sourced rows (`source='mention'`) are
 * managed by the prompt reconciler and not mutable through this router; this
 * router writes `manual` (or promotes `auto_default` → `manual`). All
 * persistence lives in `@auxx/lib/agents/agent-toolset-service`; the router
 * just validates input, enforces org scope via the cache, and delegates.
 */
export const agentToolsetRouter = createTRPCRouter({
  /**
   * Org-wide toolset catalog — every available toolset slug and its tools.
   * Per-agent enabled state lives on `agent.getById.toolsets`.
   */
  list: adminProcedure.query(async ({ ctx }) => {
    return getOrgToolsetCatalog(ctx.session.organizationId)
  }),

  update: adminProcedure
    .input(toolsetPatchSchema.extend({ agentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      await ensureAgentInOrg(organizationId, input.agentId)

      await updateAgentToolset(organizationId, input.agentId, {
        slug: input.slug,
        enabled: input.enabled,
        disabledTools: input.disabledTools,
      })

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
      await ensureAgentInOrg(organizationId, input.agentId)

      await batchUpdateAgentToolsets(organizationId, input.agentId, input.toolsets)

      logger.info('Agent toolsets batch-updated', {
        organizationId,
        agentId: input.agentId,
        count: input.toolsets.length,
      })
    }),
})
