// apps/web/src/server/api/routers/quick-actions.ts

import { QuickActionExecutor } from '@auxx/lib/quick-actions'
import { TicketEventType, TimelineActorType, TimelineEntityType } from '@auxx/lib/timeline'
import { createScopedLogger } from '@auxx/logger'
import { createTimelineEvent } from '@auxx/services/timeline'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'

const logger = createScopedLogger('trpc-quick-actions')

const draftActionPayloadSchema = z.object({
  appId: z.string(),
  installationId: z.string(),
  actionId: z.string(),
  inputs: z.record(z.string(), z.unknown()),
  display: z.object({
    label: z.string(),
    icon: z.string().optional(),
    color: z.string().optional(),
    summary: z.string(),
  }),
})

export const quickActionRouter = createTRPCRouter({
  /**
   * Execute one or more quick actions at send time.
   * All actions run concurrently. Results are returned for each action.
   */
  execute: protectedProcedure
    .input(
      z.object({
        actions: z.array(draftActionPayloadSchema).min(1),
        context: z.object({
          threadId: z.string().optional(),
          ticketId: z.string().optional(),
        }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session

      // Get organization handle for Lambda context
      const organization = await ctx.db.query.Organization.findFirst({
        where: (orgs, { eq }) => eq(orgs.id, organizationId),
      })

      if (!organization) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Organization not found',
        })
      }

      const user = await ctx.db.query.User.findFirst({
        where: (users, { eq }) => eq(users.id, userId),
      })

      const executor = new QuickActionExecutor()
      const results = await executor.executeAll(input.actions, {
        userId,
        organizationId,
        organizationHandle: organization.handle!,
        userEmail: user?.email ?? '',
        userName: user?.name ?? '',
        threadId: input.context.threadId,
        ticketId: input.context.ticketId,
      })

      // Log timeline events for successful actions
      for (const result of results) {
        if (!result.success) continue

        const action = input.actions.find((a) => a.actionId === result.actionId)
        if (!action || !input.context.ticketId) continue

        try {
          await createTimelineEvent({
            organizationId,
            entityType: TimelineEntityType.TICKET,
            entityId: input.context.ticketId,
            eventType: TicketEventType.QUICK_ACTION_EXECUTED,
            actor: {
              type: TimelineActorType.USER,
              id: userId,
              name: user?.name ?? undefined,
              email: user?.email ?? undefined,
            },
            eventData: {
              appId: action.appId,
              actionId: action.actionId,
              label: action.display.label,
              summary: action.display.summary,
              outputs: result.outputs,
            },
          })
        } catch (error) {
          logger.error('Failed to create timeline event for quick action', {
            actionId: result.actionId,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      return results
    }),
})
