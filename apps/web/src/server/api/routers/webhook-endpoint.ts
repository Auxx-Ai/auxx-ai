// apps/web/src/server/api/routers/webhook-endpoint.ts
// tRPC router for INBOUND webhook endpoints (api.webhookEndpoint). Distinct from the
// OUTBOUND `api.webhook` (Auxx → other apps). CRUD + rotateSecret over the WebhookEndpoint
// table; `create`/`rotateSecret` return the minted secret in plaintext ONCE, every read masks it.
// All logic lives in the `@auxx/lib/webhooks/webhook-endpoint` service (Drizzle, thrown AuxxErrors).

import {
  getWebhookEndpointTemplate,
  listWebhookEndpointTemplates,
} from '@auxx/lib/webhooks/endpoint-templates'
import {
  createWebhookEndpoint,
  deleteWebhookEndpoint,
  getWebhookEndpoint,
  listWebhookEndpoints,
  rotateWebhookEndpointSecret,
  updateWebhookEndpoint,
} from '@auxx/lib/webhooks/webhook-endpoint'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'

const verificationSchema = z.enum(['none', 'token', 'hmac', 'stripe'])
const signatureEncodingSchema = z.enum(['hex', 'base64'])
const topicSourceSchema = z.object({
  kind: z.enum(['header', 'path']),
  value: z.string().min(1),
})
const topicSchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
  name: z.string().optional(),
  schema: z.record(z.string(), z.unknown()).optional(),
  schemaSource: z.enum(['inferred', 'manual']).optional(),
  sampleEventId: z.string().optional(),
})

export const webhookEndpointRouter = createTRPCRouter({
  list: protectedProcedure.query(({ ctx }) =>
    listWebhookEndpoints(ctx.db, ctx.session.organizationId)
  ),

  /** Predefined endpoint templates (Shopify/Stripe/GitHub + blank) for the "Add" gallery. */
  getTemplates: protectedProcedure.query(() => listWebhookEndpointTemplates()),

  getTemplateById: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(({ input }) => getWebhookEndpointTemplate(input.id)),

  get: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(({ ctx, input }) => getWebhookEndpoint(ctx.db, ctx.session.organizationId, input.id)),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1, 'Name is required'),
        provider: z.string().optional(),
        verification: verificationSchema.default('hmac'),
        signatureHeader: z.string().optional(),
        signaturePrefix: z.string().optional(),
        signatureEncoding: signatureEncodingSchema.optional(),
        /** Provider-minted signing secret pasted by the user (Stripe `whsec_…`). */
        secret: z.string().optional(),
        topicSource: topicSourceSchema.nullish(),
        topics: z.array(topicSchema).optional(),
      })
    )
    .mutation(({ ctx, input }) =>
      createWebhookEndpoint(ctx.db, ctx.session.organizationId, {
        ...input,
        createdById: ctx.session.user.id,
      })
    ),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1).optional(),
        verification: verificationSchema.optional(),
        signatureHeader: z.string().nullish(),
        signaturePrefix: z.string().nullish(),
        signatureEncoding: signatureEncodingSchema.optional(),
        topicSource: topicSourceSchema.nullish(),
        topics: z.array(topicSchema).optional(),
      })
    )
    .mutation(({ ctx, input }) => {
      const { id, ...patch } = input
      return updateWebhookEndpoint(ctx.db, ctx.session.organizationId, id, patch)
    }),

  rotateSecret: protectedProcedure
    // `secret` is the replacement `whsec_…` for stripe endpoints; token/hmac mint a fresh one.
    .input(z.object({ id: z.string().min(1), secret: z.string().optional() }))
    .mutation(({ ctx, input }) =>
      rotateWebhookEndpointSecret(ctx.db, ctx.session.organizationId, input.id, input.secret)
    ),

  delete: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      deleteWebhookEndpoint(ctx.db, ctx.session.organizationId, input.id)
    ),
})
