import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'
import { WebhookService } from '@auxx/lib/webhooks'
import { SubscriptionModel } from '@auxx/database/models'

import { WEBHOOK_EVENT_TYPES } from '@auxx/lib/webhooks/types'

// Create a zod schema for validating event types
const eventTypeSchema = z.enum([...(Object.values(WEBHOOK_EVENT_TYPES) as [string, ...string[]])])

export const webhookRouters = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    const { organizationId } = ctx.session
    const service = new WebhookService(organizationId, ctx.db)
    return await service.list({ organizationId })
  }),

  byId: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const { organizationId } = ctx.session

    const service = new WebhookService(organizationId, ctx.db)
    const result = await service.byId({ id: input.id, organizationId })

    if (!result.success) {
      throw result.error
    }

    return result.value
  }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1, 'Name is required'),
        url: z.string().url('Must be a valid URL'),
        eventTypes: z.array(eventTypeSchema),
        isActive: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      const service = new WebhookService(organizationId, ctx.db)
      const result = await service.createWebhook({ params: { ...input, organizationId } })

      return result.unwrap()
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1, 'Name is required'),
        url: z.string().url('Must be a valid URL'),
        eventTypes: z.array(eventTypeSchema),
        isActive: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      const service = new WebhookService(organizationId, ctx.db)

      // First verify the webhook belongs to the organization
      const webhookResult = await service.byId({ id: input.id, organizationId })
      // webhookResult.unwrap().
      if (webhookResult.error) {
        throw webhookResult.error
      }

      const result = await service.updateWebhook({ params: input })

      // if (!result.ok) {
      //   throw result.error
      // }

      return result.unwrap()
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      const service = new WebhookService(organizationId, ctx.db)

      // First verify the webhook belongs to the organization
      const webhookResult = await service.byId({ id: input.id, organizationId })

      if (!webhookResult.ok) {
        throw webhookResult.error
      }

      const result = await service.deleteWebhook({ id: input.id })

      if (!result.ok) {
        throw result.error
      }
    }),

  test: protectedProcedure
    .input(z.object({ url: z.string().url('Must be a valid URL') }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      const service = new WebhookService(organizationId, ctx.db)
      const result = await service.testEndpoint({ url: input.url })

      if (!result.ok) {
        throw result.error
      }

      return result.value
    }),

  // old. delete
  getEvents: protectedProcedure
    .input(
      z.object({
        provider: z.enum(['google', 'shopify']).default('shopify'),
        topic: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      // Use Drizzle model with scoped, safe selection
      const model = new SubscriptionModel(organizationId)
      const result = await model.listByProvider({ provider: input.provider, topic: input.topic })
      if (!result.ok) throw result.error

      return { subscriptions: result.value }
    }),
})
