// apps/web/src/server/api/routers/agent-scope.ts

import {
  agentExistsInOrg,
  PinLimitExceededError,
  removeAgentScopeRow,
  ScopeRowImmutableError,
  setAgentPin,
  upsertAgentScopeRow,
} from '@auxx/lib/agents'
import { createScopedLogger } from '@auxx/logger'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { adminProcedure, createTRPCRouter } from '../trpc'

const logger = createScopedLogger('agent-scope-router')

const scopeModeSchema = z.enum(['include_descendants', 'include_one', 'exclude'])
const recordIdSchema = z.string().min(1).max(180)

async function ensureAgentInOrg(organizationId: string, agentId: string): Promise<void> {
  if (!(await agentExistsInOrg(organizationId, agentId))) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' })
  }
}

function mapServiceError(err: unknown): TRPCError {
  if (err instanceof PinLimitExceededError) {
    return new TRPCError({ code: 'BAD_REQUEST', message: err.message })
  }
  if (err instanceof ScopeRowImmutableError) {
    return new TRPCError({ code: 'CONFLICT', message: err.message })
  }
  return new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: err instanceof Error ? err.message : 'Unknown error',
  })
}

/**
 * Per-agent resource scope + pinned-records mutations. Reads come from
 * `agent.getById.resourceScopes` and `agent.getById.pinnedRecords`.
 * Mention-sourced rows are owned by the prompt reconciler and are rejected
 * here; admin edits write `manual`.
 */
export const agentScopeRouter = createTRPCRouter({
  upsertRow: adminProcedure
    .input(
      z.object({
        agentId: z.string(),
        recordId: recordIdSchema,
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
      logger.info('Agent scope row upserted', {
        organizationId,
        agentId: input.agentId,
        recordId: input.recordId,
        mode: input.mode,
      })
    }),

  removeRow: adminProcedure
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
      logger.info('Agent scope row removed', {
        organizationId,
        agentId: input.agentId,
        recordId: input.recordId,
      })
    }),

  setPin: adminProcedure
    .input(
      z.object({
        agentId: z.string(),
        recordId: recordIdSchema,
        pinned: z.boolean(),
        note: z.string().max(280).nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      await ensureAgentInOrg(organizationId, input.agentId)
      try {
        await setAgentPin(organizationId, input)
      } catch (err) {
        throw mapServiceError(err)
      }
      logger.info('Agent pin toggled', {
        organizationId,
        agentId: input.agentId,
        recordId: input.recordId,
        pinned: input.pinned,
      })
    }),
})
