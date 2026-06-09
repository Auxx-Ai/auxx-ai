// apps/web/src/server/api/routers/agent-procedure.ts

import { agentExistsInOrg } from '@auxx/lib/agents'
import {
  attachProcedure,
  createProcedure,
  detachProcedure,
  listAgentProcedures,
  listProcedures,
  updateAgentProcedure,
} from '@auxx/lib/agents/procedures'
import { FeaturePermissionService } from '@auxx/lib/permissions'
import { FeatureKey } from '@auxx/lib/permissions/client'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { adminProcedure, createTRPCRouter, protectedProcedure } from '../trpc'
import { unwrap } from '../unwrap'

/** adminProcedure + a beta gate: requires the `agentProcedures` feature on the org's plan. */
const agentProceduresAdminProcedure = adminProcedure.use(async ({ ctx, next }) => {
  await new FeaturePermissionService().requireAccess(
    ctx.session.organizationId,
    FeatureKey.agentProcedures
  )
  return next()
})

async function ensureAgentInOrg(organizationId: string, agentId: string): Promise<void> {
  if (!(await agentExistsInOrg(organizationId, agentId))) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' })
  }
}

/**
 * Agent ↔ procedure links (the M:N `AgentProcedure` table) — attach/detach + the
 * per-agent `enabled`/`priority` + optional trigger overrides. The procedure
 * library itself (the standalone `Procedure` + its draft/versions) lives on the
 * `procedure` router; this one only manages the links rendered on the agent detail.
 */
export const agentProcedureRouter = createTRPCRouter({
  // The agent's attached procedures, joined with each procedure's summary.
  list: protectedProcedure
    .input(z.object({ agentId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      await ensureAgentInOrg(organizationId, input.agentId)
      const links = unwrap(
        await listAgentProcedures({ agentId: input.agentId }),
        'list agent procedures'
      )
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
  createAndAttach: agentProceduresAdminProcedure
    .input(z.object({ agentId: z.string().min(1), name: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      await ensureAgentInOrg(organizationId, input.agentId)
      const procedure = unwrap(
        await createProcedure({ organizationId, name: input.name }),
        'create procedure'
      )
      const link = unwrap(
        await attachProcedure({
          organizationId,
          agentId: input.agentId,
          procedureId: procedure.id,
        }),
        'attach procedure'
      )
      return { linkId: link.id, procedureId: procedure.id }
    }),

  // Attach an EXISTING procedure to the agent.
  attach: agentProceduresAdminProcedure
    .input(z.object({ agentId: z.string().min(1), procedureId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      await ensureAgentInOrg(organizationId, input.agentId)
      const link = unwrap(
        await attachProcedure({
          organizationId,
          agentId: input.agentId,
          procedureId: input.procedureId,
        }),
        'attach procedure'
      )
      return { linkId: link.id }
    }),

  update: agentProceduresAdminProcedure
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
      unwrap(await updateAgentProcedure({ organizationId, id, patch }), 'update agent procedure')
      return { ok: true as const }
    }),

  detach: agentProceduresAdminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      unwrap(await detachProcedure({ organizationId, id: input.id }), 'detach procedure')
      return { ok: true as const }
    }),
})
