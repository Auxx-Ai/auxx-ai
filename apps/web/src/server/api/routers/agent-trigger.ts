// apps/web/src/server/api/routers/agent-trigger.ts

import { database, schema } from '@auxx/database'
import {
  type AgentTriggerInput,
  AgentTriggerService,
  ALLOWED_DIRECT_EVENT_TYPES,
  agentExistsInOrg,
} from '@auxx/lib/agents'
import { enqueueAgentJob } from '@auxx/lib/ai/agent-framework'
import { createScopedLogger } from '@auxx/logger'
import { createSession } from '@auxx/services'
import { TRPCError } from '@trpc/server'
import { and, desc, eq, lt } from 'drizzle-orm'
import { z } from 'zod'
import { adminProcedure, createTRPCRouter, protectedProcedure } from '../trpc'

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
  filter: z.record(z.unknown()).optional(),
})

const directEventInputSchema = z.object({
  kind: z.literal('event'),
  eventType: z.enum(ALLOWED_DIRECT_EVENT_TYPES),
  filter: z.record(z.unknown()).optional(),
})

const appInputSchema = z.object({
  kind: z.literal('app'),
  triggerAppId: z.string().min(1),
  triggerAppTriggerId: z.string().min(1),
  triggerInstallationId: z.string().min(1),
  triggerConnectionId: z.string().optional(),
  userInputs: z.record(z.unknown()).optional(),
  filter: z.record(z.unknown()).optional(),
  polling: z
    .object({
      intervalMinutes: z.number().int().positive(),
      minIntervalMinutes: z.number().int().positive().optional(),
      cron: z.string().optional(),
    })
    .optional(),
})

const triggerInputSchema = z.union([
  scheduledInputSchema,
  crudEventInputSchema,
  directEventInputSchema,
  appInputSchema,
])

async function ensureAgentInOrg(organizationId: string, agentId: string): Promise<void> {
  if (!(await agentExistsInOrg(organizationId, agentId))) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' })
  }
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

export const agentTriggerRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ agentId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      await ensureAgentInOrg(organizationId, input.agentId)
      const rows = await new AgentTriggerService().listForAgent(input.agentId, organizationId)
      return rows.map(rowToDto)
    }),

  create: adminProcedure
    .input(
      z.object({
        agentId: z.string().min(1),
        enabled: z.boolean().optional(),
        instructions: z.record(z.unknown()).nullable().optional(),
        trigger: triggerInputSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      await ensureAgentInOrg(organizationId, input.agentId)

      const row = await new AgentTriggerService().createTrigger({
        agentId: input.agentId,
        organizationId,
        createdById: userId,
        enabled: input.enabled,
        instructions: input.instructions ?? null,
        trigger: input.trigger as AgentTriggerInput,
      })

      logger.info('Agent trigger created', {
        organizationId,
        agentId: input.agentId,
        triggerId: row.id,
        kind: row.kind,
      })

      return rowToDto(row)
    }),

  update: adminProcedure
    .input(
      z.object({
        id: z.string().min(1),
        enabled: z.boolean().optional(),
        instructions: z.record(z.unknown()).nullable().optional(),
        trigger: triggerInputSchema.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const row = await new AgentTriggerService().updateTrigger(input.id, organizationId, {
        enabled: input.enabled,
        instructions: input.instructions,
        trigger: input.trigger as AgentTriggerInput | undefined,
      })
      return rowToDto(row)
    }),

  delete: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      await new AgentTriggerService().deleteTrigger(input.id, organizationId)
      return { ok: true as const }
    }),

  runNow: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const service = new AgentTriggerService()
      const trigger = await service.getTrigger(input.id, organizationId)
      if (!trigger) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Trigger not found' })
      }

      const [agent] = await database
        .select({
          id: schema.Agent.id,
          userId: schema.Agent.userId,
          modelId: schema.Agent.modelId,
        })
        .from(schema.Agent)
        .where(
          and(eq(schema.Agent.id, trigger.agentId), eq(schema.Agent.organizationId, organizationId))
        )
        .limit(1)

      if (!agent) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' })
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

  listRuns: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1),
        limit: z.number().int().min(1).max(100).default(20),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
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
