// src/server/api/routers/chat.ts
//
// Chat surface for the org dashboard, gated on `channelsManage` (plan 21 §6
// Tier C). Phase 6 of the v4 plan adds `signTestJwt` so the preview page can
// dogfood the published signer and drive end-to-end identity verification
// without leaving the app.

import { signUserJwt } from '@auxx/chat/server'
import { decryptSecrets } from '@auxx/credentials/crypto'
import { schema } from '@auxx/database'
import { getUserOrganizationId } from '@auxx/lib/email'
import { PermissionKey } from '@auxx/lib/permissions'
import { createScopedLogger } from '@auxx/logger'
import { TRPCError } from '@trpc/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { createTRPCRouter, permissionProcedure } from '~/server/api/trpc'

const logger = createScopedLogger('chat-router')

const SIGN_EXPIRY = z.enum(['30s', '1m', '1h', '1d']).default('1h')

const SIGN_PAYLOAD = z
  .object({
    user_id: z.string().min(1, 'user_id is required'),
    email: z.string().email().optional(),
  })
  .catchall(z.unknown())

export const chatRouter = createTRPCRouter({
  /**
   * Sign an HS256 JWT against one of the channel's active signing keys.
   *
   * Gated on `channelsManage`. Used by the widget preview page so testers can exercise the
   * phase-3 verify path + phase-4 attribute resolution + phase-5 enforcement
   * without standing up a fake customer server. Dogfoods the published
   * `@auxx/chat/server` signer.
   *
   * Returns a typed `NO_SIGNING_KEY` error when the channel has no active
   * `ApiKey` row with `type='chat'` — the UI keys off this to render a
   * "create a signing key" CTA pointing at the channel settings.
   */
  signTestJwt: permissionProcedure(PermissionKey.channelsManage)
    .input(
      z.object({
        channelId: z.string().min(1),
        payload: SIGN_PAYLOAD,
        expiresIn: SIGN_EXPIRY,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = getUserOrganizationId(ctx.session)

      // Channel ownership check — bypassing this would let one org's admin
      // mint a JWT against another org's channel.
      const integration = await ctx.db.query.Integration.findFirst({
        where: and(
          eq(schema.Integration.id, input.channelId),
          eq(schema.Integration.organizationId, organizationId)
        ),
        columns: { id: true },
      })
      if (!integration) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Chat channel not found' })
      }

      const row = await ctx.db.query.ApiKey.findFirst({
        where: and(
          eq(schema.ApiKey.organizationId, organizationId),
          eq(schema.ApiKey.type, 'chat'),
          eq(schema.ApiKey.referenceId, input.channelId),
          eq(schema.ApiKey.isActive, true)
        ),
        columns: { id: true, encryptedSecret: true },
      })
      if (!row?.encryptedSecret) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'NO_SIGNING_KEY',
        })
      }

      let secret: string
      try {
        const decrypted = decryptSecrets<{ value?: unknown }>(row.encryptedSecret)
        const value = decrypted.value
        if (typeof value !== 'string' || !value) {
          throw new Error('Decrypted payload missing value')
        }
        secret = value
      } catch (error) {
        logger.error('Failed to decrypt chat signing key', {
          keyId: row.id,
          channelId: input.channelId,
          error: (error as Error).message,
        })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to load signing key',
        })
      }

      const token = signUserJwt(input.payload, secret, { expiresIn: input.expiresIn })
      return { token, expiresIn: input.expiresIn }
    }),
})
