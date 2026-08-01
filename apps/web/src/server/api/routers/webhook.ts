import { FeatureKey, FeaturePermissionService, PermissionKey } from '@auxx/lib/permissions'
import { WebhookService } from '@auxx/lib/webhooks'
import { WEBHOOK_EVENT_TYPES } from '@auxx/lib/webhooks/types'
import { z } from 'zod'
import { createTRPCRouter, notDemo, permissionProcedure, protectedProcedure } from '../trpc'

// Derived rather than imported: `@auxx/lib/webhooks/types` re-exports the
// `WEBHOOK_EVENT_TYPES` value but not the `WebhookEventType` type that its own
// `CreateWebhookParams`/`UpdateWebhookParams` are declared against.
type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[keyof typeof WEBHOOK_EVENT_TYPES]

// Create a zod schema for validating event types.
const eventTypeSchema = z.enum([...(Object.values(WEBHOOK_EVENT_TYPES) as [string, ...string[]])])

const WEBHOOK_EVENT_TYPE_VALUES = new Set<string>(Object.values(WEBHOOK_EVENT_TYPES))
const isWebhookEventType = (value: string): value is WebhookEventType =>
  WEBHOOK_EVENT_TYPE_VALUES.has(value)

/**
 * Narrow the parsed `string[]` to the `WebhookEventType[]` the service params
 * declare. `eventTypeSchema` widens to `string` (the tuple cast above throws the
 * literals away), so without this the payload was structurally wrong for
 * `CreateWebhookParams`/`UpdateWebhookParams`. Zod has already rejected anything
 * outside the set, so the filter never drops a value at runtime — it only tells
 * the compiler what zod enforced. Kept here rather than in the schema so the
 * client-facing input type stays `string[]`.
 */
const toEventTypes = (eventTypes: string[]): WebhookEventType[] =>
  eventTypes.filter(isWebhookEventType)

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

    // `TypedResult`'s discriminant is `ok`, not `success`. `result.success` was
    // always `undefined`, so this threw `result.error` (itself `undefined` on the
    // Ok branch) for EVERY caller — `webhook.byId` never returned a webhook.
    if (!result.ok) {
      throw result.error
    }

    return result.value
  }),

  create: permissionProcedure(PermissionKey.integrationsManage)
    .input(
      z.object({
        name: z.string().min(1, 'Name is required'),
        url: z.string().url('Must be a valid URL'),
        eventTypes: z.array(eventTypeSchema),
        isActive: z.boolean().default(true),
      })
    )
    .use(notDemo('create webhooks'))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      // Feature gate: check webhooks access
      await new FeaturePermissionService(ctx.db).requireAccess(organizationId, FeatureKey.webhooks)

      const service = new WebhookService(organizationId, ctx.db)
      const result = await service.createWebhook({
        params: { ...input, eventTypes: toEventTypes(input.eventTypes), organizationId },
      })

      return result.unwrap()
    }),

  update: permissionProcedure(PermissionKey.integrationsManage)
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

      const result = await service.updateWebhook({
        params: { ...input, eventTypes: toEventTypes(input.eventTypes) },
      })

      // if (!result.ok) {
      //   throw result.error
      // }

      return result.unwrap()
    }),

  delete: permissionProcedure(PermissionKey.integrationsManage)
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

  test: permissionProcedure(PermissionKey.integrationsManage)
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
})
