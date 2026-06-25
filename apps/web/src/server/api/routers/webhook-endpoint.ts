// apps/web/src/server/api/routers/webhook-endpoint.ts
// tRPC router for INBOUND webhook endpoints (api.webhookEndpoint). Distinct from the
// OUTBOUND `api.webhook` (Auxx → other apps). CRUD + rotateSecret over the WebhookEndpoint
// table; `create`/`rotateSecret` return the minted secret in plaintext ONCE, every read masks it.
// All logic lives in the `@auxx/lib/webhooks/webhook-endpoint` service (Drizzle, thrown AuxxErrors).

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

const verificationSchema = z.enum(['none', 'token', 'hmac'])
const signatureEncodingSchema = z.enum(['hex', 'base64'])
const topicSourceSchema = z.object({
  kind: z.enum(['header', 'path']),
  value: z.string().min(1),
})

export const webhookEndpointRouter = createTRPCRouter({
  list: protectedProcedure.query(({ ctx }) =>
    listWebhookEndpoints(ctx.db, ctx.session.organizationId)
  ),

  get: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(({ ctx, input }) => getWebhookEndpoint(ctx.db, ctx.session.organizationId, input.id)),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1, 'Name is required'),
        verification: verificationSchema.default('hmac'),
        signatureHeader: z.string().optional(),
        signaturePrefix: z.string().optional(),
        signatureEncoding: signatureEncodingSchema.optional(),
        topicSource: topicSourceSchema.nullish(),
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
      })
    )
    .mutation(({ ctx, input }) => {
      const { id, ...patch } = input
      return updateWebhookEndpoint(ctx.db, ctx.session.organizationId, id, patch)
    }),

  rotateSecret: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      rotateWebhookEndpointSecret(ctx.db, ctx.session.organizationId, input.id)
    ),

  delete: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      deleteWebhookEndpoint(ctx.db, ctx.session.organizationId, input.id)
    ),
})
