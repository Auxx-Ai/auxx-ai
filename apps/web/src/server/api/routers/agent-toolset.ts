// apps/web/src/server/api/routers/agent-toolset.ts

import {
  agentExistsInOrg,
  batchUpdateAgentToolsets,
  getOrgToolCatalog,
  updateAgentToolset,
} from '@auxx/lib/agents'
import { PermissionKey } from '@auxx/lib/permissions'
import { createScopedLogger } from '@auxx/logger'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { createTRPCRouter, permissionProcedure } from '../trpc'

const logger = createScopedLogger('agent-toolset-router')

const toolsetPatchSchema = z.object({
  slug: z.string().min(1).max(120),
  enabled: z.boolean().optional(),
  enabledTools: z.array(z.string().min(1).max(120)).max(500).optional(),
})

async function ensureAgentInOrg(organizationId: string, agentId: string): Promise<void> {
  if (!(await agentExistsInOrg(organizationId, agentId))) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' })
  }
}

/**
 * Per-agent toolset CRUD. Mention-locked rows/targets (`mentions` non-empty)
 * are managed by the prompt/procedure reconcilers — the UI blocks edits to
 * them and the reconcilers self-heal out-of-band writes on the next pass.
 * This router writes `manual` (or promotes `auto_default` → `manual`). All
 * persistence lives in `@auxx/lib/agents/agent-toolset-service`; the router
 * just validates input, enforces org scope via the cache, and delegates.
 */
export const agentToolsetRouter = createTRPCRouter({
  /**
   * Flat per-tool catalog — every tool exposed by the org, paired with its
   * parent toolset's display metadata. Backs the ReferencePicker Tools tab.
   *
   * The recursive catalog tree (formerly `list`) is no longer fetched from
   * the server — clients now derive it locally from
   * `useAppsContext().appInstallations` via `useToolCatalog`. See
   * `plans/kopilot/agents/tools/project-builtin-auxx-into-installations.md`.
   */
  listTools: permissionProcedure(PermissionKey.agentsManage).query(async ({ ctx }) => {
    return getOrgToolCatalog(ctx.session.organizationId)
  }),

  update: permissionProcedure(PermissionKey.agentsManage)
    .input(toolsetPatchSchema.extend({ agentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      await ensureAgentInOrg(organizationId, input.agentId)

      // Exclude the writer's own socket from the `agent:updated` broadcast so
      // the realtime self-echo doesn't refetch over its optimistic cache.
      const excludeSocketId = ctx.headers.get('x-realtime-socket-id') ?? undefined
      await updateAgentToolset(
        organizationId,
        input.agentId,
        {
          slug: input.slug,
          enabled: input.enabled,
          enabledTools: input.enabledTools,
        },
        { excludeSocketId }
      )

      logger.info('Agent toolset updated', {
        organizationId,
        agentId: input.agentId,
        slug: input.slug,
      })
    }),

  batchUpdate: permissionProcedure(PermissionKey.agentsManage)
    .input(
      z.object({
        agentId: z.string(),
        toolsets: z.array(toolsetPatchSchema).min(1).max(200),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      await ensureAgentInOrg(organizationId, input.agentId)

      const excludeSocketId = ctx.headers.get('x-realtime-socket-id') ?? undefined
      await batchUpdateAgentToolsets(organizationId, input.agentId, input.toolsets, {
        excludeSocketId,
      })

      logger.info('Agent toolsets batch-updated', {
        organizationId,
        agentId: input.agentId,
        count: input.toolsets.length,
      })
    }),
})
