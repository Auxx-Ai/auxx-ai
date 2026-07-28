// apps/web/src/server/api/routers/agent-trigger.ts

import { database, schema } from '@auxx/database'
import { type AgentTriggerInput, AgentTriggerService } from '@auxx/lib/agents'
import { enqueueAgentJob } from '@auxx/lib/ai/agent-framework'
import { getCachedAgentById, onCacheEvent } from '@auxx/lib/cache'
import { PermissionKey } from '@auxx/lib/permissions'
import { createScopedLogger } from '@auxx/logger'
import { createSession } from '@auxx/services'
import { TRPCError } from '@trpc/server'
import { and, desc, eq, lt } from 'drizzle-orm'
import { z } from 'zod'
import { assertAgentAccess } from '~/server/lib/agent-instance-access'
import { createTRPCRouter, permissionProcedure } from '../trpc'

const logger = createScopedLogger('agent-trigger-router')

const scheduledConfigSchema = z.object({
  triggerInterval: z.enum(['minutes', 'hours', 'days', 'weeks', 'custom']),
  timeBetweenTriggers: z.object({
    minutes: z.union([z.number(), z.string()]).optional(),
    hours: z.union([z.number(), z.string()]).optional(),
    days: z.union([z.number(), z.string()]).optional(),
    weeks: z.union([z.number(), z.string()]).optional(),
    isConstant: z.boolean().optional(),
  }),
  customCron: z.string().optional(),
  timezone: z.string().optional(),
})

const scheduledInputSchema = z.object({
  kind: z.literal('scheduled'),
  config: scheduledConfigSchema,
})

const crudEventInputSchema = z.object({
  kind: z.literal('event'),
  triggerType: z.enum(['created', 'updated', 'deleted']),
  entityDefinitionId: z.string().min(1),
  filter: z.record(z.string(), z.unknown()).optional(),
})

const appInputSchema = z.object({
  kind: z.literal('app'),
  triggerAppId: z.string().min(1),
  triggerAppTriggerId: z.string().min(1),
  triggerInstallationId: z.string().min(1),
  triggerConnectionId: z.string().optional(),
  userInputs: z.record(z.string(), z.unknown()).optional(),
  filter: z.record(z.string(), z.unknown()).optional(),
  polling: z
    .object({
      intervalMinutes: z.number().int().positive(),
      minIntervalMinutes: z.number().int().positive().optional(),
      cron: z.string().optional(),
    })
    .optional(),
})

const webhookInputSchema = z.object({
  kind: z.literal('webhook-endpoint'),
  triggerWebhookEndpointId: z.string().min(1),
  // Empty ⇒ matches every delivery (endpoints with no topicSource extract topic '').
  triggerTopic: z.string().default(''),
  filter: z.record(z.string(), z.unknown()).optional(),
})

const mentionInputSchema = z.object({ kind: z.literal('mention') })
const assignmentInputSchema = z.object({ kind: z.literal('assignment') })
const dmInputSchema = z.object({ kind: z.literal('dm') })

const triggerInputSchema = z.union([
  scheduledInputSchema,
  crudEventInputSchema,
  appInputSchema,
  webhookInputSchema,
  mentionInputSchema,
  assignmentInputSchema,
  dmInputSchema,
])

/**
 * `AgentTrigger.id` → the row, or a 404. Four of the six procedures here are
 * keyed on a TRIGGER id, but per-instance access lives on the **agent**: the
 * trigger carries it only transitively. Loading the row first is what turns
 * `input.id` into an `Agent.id` the assert can key on — without it those
 * procedures would fall back to the coarse area rung and hand a restricted
 * agent's triggers to anyone.
 *
 * The 404 lands BEFORE the assert on purpose (same rule as
 * `resolveAgentId`): a trigger from another org must not be distinguishable
 * from one the caller is restricted from.
 */
async function loadTrigger(triggerId: string, organizationId: string) {
  const trigger = await new AgentTriggerService().getTrigger(triggerId, organizationId)
  if (!trigger) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Trigger not found' })
  }
  return trigger
}

function rowToDto(row: typeof schema.AgentTrigger.$inferSelect) {
  return {
    id: row.id,
    agentId: row.agentId,
    organizationId: row.organizationId,
    kind: row.kind,
    enabled: row.enabled,
    triggerType: row.triggerType,
    entityDefinitionId: row.entityDefinitionId,
    eventType: row.eventType,
    triggerAppId: row.triggerAppId,
    triggerAppTriggerId: row.triggerAppTriggerId,
    triggerInstallationId: row.triggerInstallationId,
    triggerConnectionId: row.triggerConnectionId,
    triggerWebhookEndpointId: row.triggerWebhookEndpointId,
    triggerTopic: row.triggerTopic,
    config: row.config,
    instructions: row.instructions,
    lastFiredAt: row.lastFiredAt ? row.lastFiredAt.toISOString() : null,
    lastErrorAt: row.lastErrorAt ? row.lastErrorAt.toISOString() : null,
    lastError: row.lastError,
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/**
 * Agent triggers — per-agent instance access (plan 25 §4.2).
 *
 * Tiers here are deliberately lopsided: reading which triggers exist and what
 * they fired is **view**, but every WRITE is **admin**, not edit. A trigger is
 * the thing that makes an agent act autonomously on its OWN credentials with no
 * invoker to intersect against (`agent-run-capabilities.ts` only narrows to the
 * invoker on human-driven paths; schedules, record events, app triggers and
 * webhooks pass none). So authoring a trigger is closer to publishing the agent
 * than to editing its prompt — user decision 2026-07-28, same rung as
 * `runAsUserId` and `permissionProfileId`. `runNow` fires the agent on the spot,
 * so it sits on the same rung as creating the trigger that would have fired it.
 *
 * Base procedure is `permissionProcedure(agentsView)` throughout, with the real
 * decision in the body (`workflow.ts` precedent): the coarse rung keeps the
 * plan-AND these procedures already ran, and a member composing `agents: None`
 * who holds one explicit instance grant genuinely holds `agentsView` because the
 * composer derives that Read rung from their grants. **Every procedure on that
 * base must assert on a specific agent** — the derived key says only "this
 * member has some agent access", never which agent.
 */
export const agentTriggerRouter = createTRPCRouter({
  list: permissionProcedure(PermissionKey.agentsView)
    .input(z.object({ agentId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const agentId = await assertAgentAccess({
        capabilities: ctx.capabilities,
        organizationId,
        idOrSlug: input.agentId,
        tier: 'view',
      })
      const rows = await new AgentTriggerService().listForAgent(agentId, organizationId)
      return rows.map(rowToDto)
    }),

  create: permissionProcedure(PermissionKey.agentsView)
    .input(
      z.object({
        agentId: z.string().min(1),
        enabled: z.boolean().optional(),
        instructions: z.record(z.string(), z.unknown()).nullable().optional(),
        trigger: triggerInputSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const agentId = await assertAgentAccess({
        capabilities: ctx.capabilities,
        organizationId,
        idOrSlug: input.agentId,
        tier: 'admin',
      })

      const row = await new AgentTriggerService().createTrigger({
        agentId,
        organizationId,
        createdById: userId,
        enabled: input.enabled,
        instructions: input.instructions ?? null,
        trigger: input.trigger as AgentTriggerInput,
      })

      // All triggers live on the cached agent — invalidate so dispatchers
      // and per-trigger jobs pick up the new state.
      await onCacheEvent('agent.updated', { orgId: organizationId })

      logger.info('Agent trigger created', {
        organizationId,
        agentId,
        triggerId: row.id,
        kind: row.kind,
      })

      return rowToDto(row)
    }),

  update: permissionProcedure(PermissionKey.agentsView)
    .input(
      z.object({
        id: z.string().min(1),
        enabled: z.boolean().optional(),
        instructions: z.record(z.string(), z.unknown()).nullable().optional(),
        trigger: triggerInputSchema.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const trigger = await loadTrigger(input.id, organizationId)
      await assertAgentAccess({
        capabilities: ctx.capabilities,
        organizationId,
        idOrSlug: trigger.agentId,
        tier: 'admin',
      })
      const row = await new AgentTriggerService().updateTrigger(input.id, organizationId, {
        enabled: input.enabled,
        instructions: input.instructions,
        trigger: input.trigger as AgentTriggerInput | undefined,
      })
      await onCacheEvent('agent.updated', { orgId: organizationId })
      return rowToDto(row)
    }),

  delete: permissionProcedure(PermissionKey.agentsView)
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const trigger = await loadTrigger(input.id, organizationId)
      await assertAgentAccess({
        capabilities: ctx.capabilities,
        organizationId,
        idOrSlug: trigger.agentId,
        tier: 'admin',
      })
      await new AgentTriggerService().deleteTrigger(input.id, organizationId)
      await onCacheEvent('agent.updated', { orgId: organizationId })
      return { ok: true as const }
    }),

  runNow: permissionProcedure(PermissionKey.agentsView)
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const trigger = await loadTrigger(input.id, organizationId)
      // Firing the agent by hand is the trigger's whole effect, minus the wait —
      // it runs on the agent's credentials with `approvalMode: 'auto'`. Same
      // admin rung as authoring the trigger.
      await assertAgentAccess({
        capabilities: ctx.capabilities,
        organizationId,
        idOrSlug: trigger.agentId,
        tier: 'admin',
      })

      const agent = await getCachedAgentById(organizationId, trigger.agentId)
      if (!agent || agent.archivedAt) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' })
      }
      if (!agent.userId) {
        // Draft agent: no synthetic User, can't run.
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Complete agent setup before firing a manual run.',
        })
      }

      const firedAt = new Date().toISOString()
      const sessionResult = await createSession({
        organizationId,
        userId: agent.userId,
        type: 'kopilot',
        agentId: agent.id,
        agentTriggerId: trigger.id,
        triggerContext: {
          kind: trigger.kind,
          firedAt,
          manual: true,
          firedByUserId: userId,
        },
        modelId: agent.modelId,
      })

      if (sessionResult.isErr()) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to create session: ${sessionResult.error.message}`,
        })
      }

      const session = sessionResult.value
      await enqueueAgentJob({
        sessionId: session.id,
        organizationId,
        userId: agent.userId,
        message: 'Manual run-now fired from the agent triggers tab.',
        type: 'message',
        domain: 'kopilot',
        agentId: agent.id,
        agentTriggerId: trigger.id,
        approvalMode: 'auto',
        modelId: agent.modelId ?? undefined,
      })

      logger.info('Run-now fired for agent trigger', {
        triggerId: trigger.id,
        sessionId: session.id,
      })

      return { sessionId: session.id }
    }),

  listRuns: permissionProcedure(PermissionKey.agentsView)
    .input(
      z.object({
        id: z.string().min(1),
        limit: z.number().int().min(1).max(100).default(20),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      // Single-agent shape: every row returned belongs to the ONE trigger named
      // in the input, so this asserts rather than filters.
      const trigger = await loadTrigger(input.id, organizationId)
      await assertAgentAccess({
        capabilities: ctx.capabilities,
        organizationId,
        idOrSlug: trigger.agentId,
        tier: 'view',
      })
      const conditions = [
        eq(schema.AiAgentSession.organizationId, organizationId),
        eq(schema.AiAgentSession.agentTriggerId, input.id),
      ]
      if (input.cursor) {
        conditions.push(lt(schema.AiAgentSession.updatedAt, new Date(input.cursor)))
      }
      const rows = await database
        .select({
          id: schema.AiAgentSession.id,
          title: schema.AiAgentSession.title,
          type: schema.AiAgentSession.type,
          createdAt: schema.AiAgentSession.createdAt,
          updatedAt: schema.AiAgentSession.updatedAt,
          triggerContext: schema.AiAgentSession.triggerContext,
        })
        .from(schema.AiAgentSession)
        .where(and(...conditions))
        .orderBy(desc(schema.AiAgentSession.updatedAt))
        .limit(input.limit + 1)

      const hasMore = rows.length > input.limit
      const items = hasMore ? rows.slice(0, input.limit) : rows
      const nextCursor =
        hasMore && items.length > 0 ? items[items.length - 1]!.updatedAt.toISOString() : undefined

      return {
        items: items.map((r) => ({
          id: r.id,
          title: r.title,
          type: r.type,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
          triggerContext: r.triggerContext,
        })),
        nextCursor,
      }
    }),
})
