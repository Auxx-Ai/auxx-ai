// apps/web/src/server/api/routers/quick-actions.ts

import { QuickActionExecutor, resolveQuickActionOptions } from '@auxx/lib/quick-actions'
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

  /**
   * Resolve the live options for a quick-action `dynamic-select` input (e.g. the
   * Stripe charges for the thread's contact). Read-only — runs the app's resolver
   * tool, scoped to `recordId`. See plans/actions/09-dynamic-action-inputs.md.
   */
  resolveOptions: protectedProcedure
    .input(
      z.object({
        appId: z.string(),
        installationId: z.string(),
        actionId: z.string(),
        fieldKey: z.string(),
        recordId: z.string(),
        query: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session

      // Validate the subject record belongs to the caller's org before binding.
      const [entityDefinitionId, entityInstanceId] = input.recordId.split(':')
      if (!entityDefinitionId || !entityInstanceId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid recordId' })
      }
      const instance = await ctx.db.query.EntityInstance.findFirst({
        where: (rows, { eq, and }) =>
          and(eq(rows.id, entityInstanceId), eq(rows.organizationId, organizationId)),
        columns: { id: true },
      })
      if (!instance) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Record not found' })
      }

      const organization = await ctx.db.query.Organization.findFirst({
        where: (orgs, { eq }) => eq(orgs.id, organizationId),
      })
      if (!organization?.handle) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Organization not found' })
      }
      const user = await ctx.db.query.User.findFirst({
        where: (users, { eq }) => eq(users.id, userId),
      })

      return resolveQuickActionOptions({
        appId: input.appId,
        installationId: input.installationId,
        actionId: input.actionId,
        fieldKey: input.fieldKey,
        recordId: input.recordId,
        query: input.query,
        organizationId,
        organizationHandle: organization.handle,
        userId,
        userEmail: user?.email ?? '',
        userName: user?.name ?? '',
      })
    }),
})
