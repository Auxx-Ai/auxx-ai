// apps/web/src/server/api/routers/agent-toolset.ts

import { batchUpdateAgentToolsets, getOrgToolCatalog, updateAgentToolset } from '@auxx/lib/agents'
import { PermissionKey } from '@auxx/lib/permissions'
import { createScopedLogger } from '@auxx/logger'
import { z } from 'zod'
import { assertAgentAccess } from '~/server/lib/agent-instance-access'
import { createTRPCRouter, permissionProcedure } from '../trpc'

const logger = createScopedLogger('agent-toolset-router')

const toolsetPatchSchema = z.object({
  slug: z.string().min(1).max(120),
  enabled: z.boolean().optional(),
  enabledTools: z.array(z.string().min(1).max(120)).max(500).optional(),
})

/**
 * Per-agent toolset CRUD. Mention-locked rows/targets (`mentions` non-empty)
 * are managed by the prompt/procedure reconcilers — the UI blocks edits to
 * them and the reconcilers self-heal out-of-band writes on the next pass.
 * This router writes `manual` (or promotes `auto_default` → `manual`). All
 * persistence lives in `@auxx/lib/agents/agent-toolset-service`; the router
 * just validates input, delegates, and — since plan 25 §4.2 — decides access
 * per-agent.
 *
 * Toolsets are authoring surface, so the writes sit on **edit**
 * (`assertAgentAccess(..., 'edit')`), which also replaces the old
 * `ensureAgentInOrg` org-scope check: resolution 404s an out-of-org id before
 * the assert runs.
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
   *
   * Takes NO agent id and returns nothing agent-specific — it is the ORG's tool
   * catalogue, the picker's raw material. So it stays coarse, but on
   * `agentsView` rather than the authoring rung: an instance-`view` holder has
   * to be able to render an agent's enabled tools with their display metadata,
   * and gating that on `agentsManage` is exactly the bug #1346 shipped for
   * workflows.
   */
  listTools: permissionProcedure(PermissionKey.agentsView).query(async ({ ctx }) => {
    return getOrgToolCatalog(ctx.session.organizationId)
  }),

  update: permissionProcedure(PermissionKey.agentsView)
    .input(toolsetPatchSchema.extend({ agentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const agentId = await assertAgentAccess({
        capabilities: ctx.capabilities,
        organizationId,
        idOrSlug: input.agentId,
        tier: 'edit',
      })

      // Exclude the writer's own socket from the `agent:updated` broadcast so
      // the realtime self-echo doesn't refetch over its optimistic cache.
      const excludeSocketId = ctx.headers.get('x-realtime-socket-id') ?? undefined
      await updateAgentToolset(
        organizationId,
        agentId,
        {
          slug: input.slug,
          enabled: input.enabled,
          enabledTools: input.enabledTools,
        },
        { excludeSocketId }
      )

      logger.info('Agent toolset updated', {
        organizationId,
        agentId,
        slug: input.slug,
      })
    }),

  batchUpdate: permissionProcedure(PermissionKey.agentsView)
    .input(
      z.object({
        agentId: z.string(),
        toolsets: z.array(toolsetPatchSchema).min(1).max(200),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const agentId = await assertAgentAccess({
        capabilities: ctx.capabilities,
        organizationId,
        idOrSlug: input.agentId,
        tier: 'edit',
      })

      const excludeSocketId = ctx.headers.get('x-realtime-socket-id') ?? undefined
      await batchUpdateAgentToolsets(organizationId, agentId, input.toolsets, {
        excludeSocketId,
      })

      logger.info('Agent toolsets batch-updated', {
        organizationId,
        agentId,
        count: input.toolsets.length,
      })
    }),
})
