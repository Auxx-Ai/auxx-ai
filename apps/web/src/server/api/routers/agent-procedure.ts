// apps/web/src/server/api/routers/agent-procedure.ts

import { type Database, schema } from '@auxx/database'
import {
  attachProcedure,
  createProcedure,
  detachProcedure,
  listAgentProcedures,
  listProcedures,
  reconcileAgentProcedureMentions,
  updateAgentProcedure,
} from '@auxx/lib/agents/procedures'
import { FeaturePermissionService, PermissionKey } from '@auxx/lib/permissions'
import { FeatureKey } from '@auxx/lib/permissions/client'
import { TRPCError } from '@trpc/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { assertAgentAccess } from '~/server/lib/agent-instance-access'
import { createTRPCRouter, permissionProcedure } from '../trpc'
import { unwrap } from '../unwrap'

/**
 * `permissionProcedure(agentsView)` + the `agentProcedures` beta plan gate.
 *
 * The coarse rung is the derived Read key, not `agentsManage`: the real decision
 * is the per-agent `assertAgentAccess(..., 'edit')` in each body (`workflow.ts`
 * precedent — see `agent-trigger.ts`'s router doc for why). Procedures are
 * authoring surface, so they sit on **edit**, unlike triggers.
 */
const agentProceduresWriteProcedure = permissionProcedure(PermissionKey.agentsView).use(
  async ({ ctx, next }) => {
    await new FeaturePermissionService().requireAccess(
      ctx.session.organizationId,
      FeatureKey.agentProcedures
    )
    return next()
  }
)

/**
 * `AgentProcedure.id` (a LINK id) → the agent it hangs off, or a 404.
 *
 * `update` and `detach` name only the link, but per-instance access is keyed on
 * the agent — so the link has to be resolved BEFORE the write, not read off the
 * service's return value afterwards (which is what `detachProcedure` hands back,
 * far too late to authorize anything).
 */
async function resolveLinkAgentId(
  db: Database,
  organizationId: string,
  linkId: string
): Promise<string> {
  const [row] = await db
    .select({ agentId: schema.AgentProcedure.agentId })
    .from(schema.AgentProcedure)
    .where(
      and(
        eq(schema.AgentProcedure.id, linkId),
        eq(schema.AgentProcedure.organizationId, organizationId)
      )
    )
    .limit(1)
  if (!row) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Procedure link not found' })
  }
  return row.agentId
}

/**
 * Agent ↔ procedure links (the M:N `AgentProcedure` table) — attach/detach + the
 * per-agent `enabled`/`priority` + optional trigger overrides. The procedure
 * library itself (the standalone `Procedure` + its draft/versions) lives on the
 * `procedure` router; this one only manages the links rendered on the agent detail.
 */
export const agentProcedureRouter = createTRPCRouter({
  // The agent's attached procedures, joined with each procedure's summary.
  list: permissionProcedure(PermissionKey.agentsView)
    .input(z.object({ agentId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      // Single-agent shape — every link returned belongs to `input.agentId`, so
      // this asserts rather than filters.
      const agentId = await assertAgentAccess({
        capabilities: ctx.capabilities,
        organizationId,
        idOrSlug: input.agentId,
        tier: 'view',
      })
      const links = unwrap(await listAgentProcedures({ agentId }), 'list agent procedures')
      const procedures = unwrap(await listProcedures({ organizationId }), 'list procedures')
      const byId = new Map(procedures.map((p) => [p.id, p]))
      return links
        .map((link) => {
          const proc = byId.get(link.procedureId)
          if (!proc) return null
          return {
            linkId: link.id,
            procedureId: proc.id,
            name: proc.name,
            whenToUse: link.whenToUseOverride ?? proc.whenToUse,
            enabled: link.enabled,
            priority: link.priority,
            hasUnpublishedChanges: proc.hasUnpublishedChanges,
            isPublished: proc.activeVersionId != null,
          }
        })
        .filter((row): row is NonNullable<typeof row> => row != null)
    }),

  // "Add procedure": create a new standalone procedure and attach it to the agent.
  createAndAttach: agentProceduresWriteProcedure
    .input(z.object({ agentId: z.string().min(1), name: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const agentId = await assertAgentAccess({
        capabilities: ctx.capabilities,
        organizationId,
        idOrSlug: input.agentId,
        tier: 'edit',
      })
      const procedure = unwrap(
        await createProcedure({ organizationId, name: input.name }),
        'create procedure'
      )
      const link = unwrap(
        await attachProcedure({ organizationId, agentId, procedureId: procedure.id }),
        'attach procedure'
      )
      // A fresh procedure has an empty doc, but reconcile anyway so the agent's
      // `'procedure'` tag is initialized (and stays correct if the create seeds a body).
      await reconcileAgentProcedureMentions(organizationId, agentId)
      return { linkId: link.id, procedureId: procedure.id }
    }),

  // Attach an EXISTING procedure to the agent.
  attach: agentProceduresWriteProcedure
    .input(z.object({ agentId: z.string().min(1), procedureId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const agentId = await assertAgentAccess({
        capabilities: ctx.capabilities,
        organizationId,
        idOrSlug: input.agentId,
        tier: 'edit',
      })
      const link = unwrap(
        await attachProcedure({ organizationId, agentId, procedureId: input.procedureId }),
        'attach procedure'
      )
      // Attaching an existing (possibly published) procedure can lock new
      // toolsets/knowledge on the agent — reconcile its `'procedure'` tag.
      await reconcileAgentProcedureMentions(organizationId, agentId)
      return { linkId: link.id }
    }),

  update: agentProceduresWriteProcedure
    .input(
      z.object({
        id: z.string().min(1),
        enabled: z.boolean().optional(),
        priority: z.number().int().optional(),
        whenToUseOverride: z.string().nullable().optional(),
        triggerExamplesOverride: z.array(z.unknown()).nullable().optional(),
        rulesetOverride: z.array(z.unknown()).nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const { id, ...patch } = input
      await assertAgentAccess({
        capabilities: ctx.capabilities,
        organizationId,
        idOrSlug: await resolveLinkAgentId(ctx.db, organizationId, id),
        tier: 'edit',
      })
      const row = unwrap(
        await updateAgentProcedure({ organizationId, id, patch }),
        'update agent procedure'
      )
      // Only an enabled flip changes the agent's effective procedure set;
      // priority/override edits don't. Reconcile is idempotent, so re-running on a
      // no-op enabled patch is harmless — gate on the field being present.
      if (input.enabled !== undefined) {
        await reconcileAgentProcedureMentions(organizationId, row.agentId)
      }
      return { ok: true as const }
    }),

  detach: agentProceduresWriteProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      await assertAgentAccess({
        capabilities: ctx.capabilities,
        organizationId,
        idOrSlug: await resolveLinkAgentId(ctx.db, organizationId, input.id),
        tier: 'edit',
      })
      // detach returns the removed link's agentId so we can reconcile its
      // `'procedure'` tag AFTER the delete (the link is now excluded).
      const agentId = unwrap(
        await detachProcedure({ organizationId, id: input.id }),
        'detach procedure'
      )
      if (agentId) await reconcileAgentProcedureMentions(organizationId, agentId)
      return { ok: true as const }
    }),
})
