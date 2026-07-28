// apps/web/src/server/api/routers/agent-scope.ts

import {
  isKnowledgeScopeRecordId,
  removeAgentScopeRow,
  ScopeRowImmutableError,
  upsertAgentScopeRow,
} from '@auxx/lib/agents'
import { PermissionKey } from '@auxx/lib/permissions'
import { createScopedLogger } from '@auxx/logger'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { assertAgentAccess } from '~/server/lib/agent-instance-access'
import { createTRPCRouter, permissionProcedure } from '../trpc'

const logger = createScopedLogger('agent-scope-router')

const scopeModeSchema = z.enum(['include_descendants', 'include_one', 'exclude'])
const recordIdSchema = z.string().min(1).max(180)
/** `upsertRow` targets a knowledge source; `removeRow` stays unrestricted so a
 * stale entity-record row from the deleted include system can still be cleared. */
const knowledgeScopeRecordIdSchema = recordIdSchema.refine(isKnowledgeScopeRecordId, {
  message: 'recordId must target a knowledge source (kb, article, or dataset)',
})

function mapServiceError(err: unknown): TRPCError {
  if (err instanceof ScopeRowImmutableError) {
    return new TRPCError({ code: 'CONFLICT', message: err.message })
  }
  return new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: err instanceof Error ? err.message : 'Unknown error',
  })
}

/**
 * Per-agent knowledge-source scope mutations — which KBs, articles and
 * datasets the agent's retrieval scope includes/excludes. This is not an
 * access-control surface; record/entity permissions are configured
 * separately (doc 14). Reads come from `agent.getById.knowledge`.
 * Mention-sourced entries are owned by the prompt reconciler and are rejected
 * here; manual edits write `manual`.
 *
 * Access is per-agent (plan 25 §4.2) at the **edit** tier — the knowledge scope
 * is part of authoring the agent, alongside its prompt, toolsets and procedures.
 * It is emphatically NOT an access-control surface (see the note above), so
 * putting it on the admin rung with triggers would be misreading what it does.
 * `assertAgentAccess` also subsumes the old `ensureAgentInOrg` check: an
 * out-of-org id fails resolution with a 404 before any capability is consulted.
 */
export const agentScopeRouter = createTRPCRouter({
  upsertRow: permissionProcedure(PermissionKey.agentsView)
    .input(
      z.object({
        agentId: z.string(),
        recordId: knowledgeScopeRecordIdSchema,
        mode: scopeModeSchema,
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
      try {
        await upsertAgentScopeRow(organizationId, { ...input, agentId })
      } catch (err) {
        throw mapServiceError(err)
      }
      logger.info('Agent knowledge entry upserted', {
        organizationId,
        agentId,
        recordId: input.recordId,
        mode: input.mode,
      })
    }),

  removeRow: permissionProcedure(PermissionKey.agentsView)
    .input(
      z.object({
        agentId: z.string(),
        recordId: recordIdSchema,
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
      try {
        await removeAgentScopeRow(organizationId, { ...input, agentId })
      } catch (err) {
        throw mapServiceError(err)
      }
      logger.info('Agent knowledge entry removed', {
        organizationId,
        agentId,
        recordId: input.recordId,
      })
    }),
})
