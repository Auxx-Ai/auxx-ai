// apps/web/src/server/api/routers/agent-scope.ts

import {
  agentExistsInOrg,
  isKnowledgeScopeRecordId,
  removeAgentScopeRow,
  ScopeRowImmutableError,
  upsertAgentScopeRow,
} from '@auxx/lib/agents'
import { PermissionKey } from '@auxx/lib/permissions'
import { createScopedLogger } from '@auxx/logger'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { createTRPCRouter, permissionProcedure } from '../trpc'

const logger = createScopedLogger('agent-scope-router')

const scopeModeSchema = z.enum(['include_descendants', 'include_one', 'exclude'])
const recordIdSchema = z.string().min(1).max(180)
/** `upsertRow` targets a knowledge source; `removeRow` stays unrestricted so a
 * stale entity-record row from the deleted include system can still be cleared. */
const knowledgeScopeRecordIdSchema = recordIdSchema.refine(isKnowledgeScopeRecordId, {
  message: 'recordId must target a knowledge source (kb, article, or dataset)',
})

async function ensureAgentInOrg(organizationId: string, agentId: string): Promise<void> {
  if (!(await agentExistsInOrg(organizationId, agentId))) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' })
  }
}

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
 * here; admin edits write `manual`.
 */
export const agentScopeRouter = createTRPCRouter({
  upsertRow: permissionProcedure(PermissionKey.agentsManage)
    .input(
      z.object({
        agentId: z.string(),
        recordId: knowledgeScopeRecordIdSchema,
        mode: scopeModeSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      await ensureAgentInOrg(organizationId, input.agentId)
      try {
        await upsertAgentScopeRow(organizationId, input)
      } catch (err) {
        throw mapServiceError(err)
      }
      logger.info('Agent knowledge entry upserted', {
        organizationId,
        agentId: input.agentId,
        recordId: input.recordId,
        mode: input.mode,
      })
    }),

  removeRow: permissionProcedure(PermissionKey.agentsManage)
    .input(
      z.object({
        agentId: z.string(),
        recordId: recordIdSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      await ensureAgentInOrg(organizationId, input.agentId)
      try {
        await removeAgentScopeRow(organizationId, input)
      } catch (err) {
        throw mapServiceError(err)
      }
      logger.info('Agent knowledge entry removed', {
        organizationId,
        agentId: input.agentId,
        recordId: input.recordId,
      })
    }),
})
