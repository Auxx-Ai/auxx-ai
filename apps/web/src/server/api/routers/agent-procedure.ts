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
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { adminProcedure, createTRPCRouter, protectedProcedure } from '../trpc'

/** Unwrap a neverthrow Result, mapping an error to a TRPCError. */
function unwrap<T>(
  result: { isErr(): boolean; value?: T; error?: { message?: string } | Error },
  message: string
): T {
  if (result.isErr()) {
    const detail =
      (result.error as { message?: string } | undefined)?.message ?? String(result.error)
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: `${message}: ${detail}` })
  }
  return result.value as T
}

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
  createAndAttach: adminProcedure
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
  attach: adminProcedure
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

  update: adminProcedure
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

  detach: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      unwrap(await detachProcedure({ organizationId, id: input.id }), 'detach procedure')
      return { ok: true as const }
    }),
})
