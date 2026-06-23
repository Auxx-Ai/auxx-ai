// ~/server/api/routers/channel-reauth.ts

import { schema } from '@auxx/database'
import { TRPCError } from '@trpc/server'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { createTRPCRouter, notDemo, protectedProcedure } from '~/server/api/trpc'

/**
 * Channel re-authentication router
 * Handles OAuth re-authentication flows and banner management
 */
export const channelReauthRouter = createTRPCRouter({
  /**
   * Initiate re-authentication for an integration
   * Uses existing OAuth services for consistent URL generation
   */
  initiateReauth: protectedProcedure
    .input(
      z.object({
        integrationId: z.string(),
      })
    )
    .use(notDemo('re-authenticate email'))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      // Verify integration exists and user has access
      const [integration] = await ctx.db
        .select()
        .from(schema.Integration)
        .where(
          and(
            eq(schema.Integration.id, input.integrationId),
            eq(schema.Integration.organizationId, organizationId),
            isNull(schema.Integration.deletedAt)
          )
        )
        .limit(1)

      if (!integration) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Integration not found',
        })
      }

      // All OAuth channels reconnect through the unified connections flow: a reconnect rotates the
      // existing credential (connectionId) and the channel/social provisioning hook relinks the row
      // (Gmail/Outlook by email; Facebook/Instagram by page/IG-account id). Stored BYO-client
      // variables are reused by the authorize route, so no re-entry needed.
      const PROVIDER_KEY_BY_CHANNEL: Record<string, string> = {
        google: 'gmail',
        outlook: 'outlookMail',
        facebook: 'facebook',
        instagram: 'instagram',
      }
      const providerKey = PROVIDER_KEY_BY_CHANNEL[integration.provider]
      if (!providerKey) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Re-authentication not supported for provider: ${integration.provider}`,
        })
      }
      if (!integration.credentialId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Channel has no linked credential to reconnect',
        })
      }
      const params = new URLSearchParams({
        connectionId: integration.credentialId,
        returnTo: '/app/settings/channels',
      })
      return {
        success: true,
        authUrl: `/api/connections/${providerKey}/oauth2/authorize?${params.toString()}`,
        message: 'Re-authentication initiated',
      }
    }),

  /**
   * Dismiss re-authentication banner
   * Uses proper database fields instead of metadata
   */
  dismissReauthBanner: protectedProcedure
    .input(
      z.object({
        integrationId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session

      // Verify integration exists and user has access
      const [integration] = await ctx.db
        .select()
        .from(schema.Integration)
        .where(
          and(
            eq(schema.Integration.id, input.integrationId),
            eq(schema.Integration.organizationId, organizationId),
            isNull(schema.Integration.deletedAt)
          )
        )
        .limit(1)

      if (!integration) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Integration not found',
        })
      }

      // Clear the requiresReauth flag on the linked credential to dismiss the banner.
      // Keep the auth error details for debugging but hide the banner.
      if (integration.credentialId) {
        await ctx.db
          .update(schema.Credential)
          .set({ requiresReauth: false })
          .where(eq(schema.Credential.id, integration.credentialId))
      }

      return {
        success: true,
        message: 'Re-authentication banner dismissed',
      }
    }),

  /**
   * Get integration authentication status
   * Uses proper database fields instead of metadata
   */
  getAuthStatus: protectedProcedure
    .input(
      z.object({
        integrationId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session

      const [integration] = await ctx.db
        .select({
          id: schema.Integration.id,
          provider: schema.Integration.provider,
          enabled: schema.Integration.enabled,
          email: schema.Integration.email,
          name: schema.Integration.name,
          lastSyncedAt: schema.Integration.lastSyncedAt,
          lastSuccessfulSync: schema.Integration.lastSuccessfulSync,
          lastAuthError: schema.Credential.lastAuthError,
          lastAuthErrorAt: schema.Credential.lastAuthErrorAt,
          requiresReauth: schema.Credential.requiresReauth,
        })
        .from(schema.Integration)
        .leftJoin(schema.Credential, eq(schema.Credential.id, schema.Integration.credentialId))
        .where(
          and(
            eq(schema.Integration.id, input.integrationId),
            eq(schema.Integration.organizationId, organizationId),
            isNull(schema.Integration.deletedAt)
          )
        )
        .limit(1)

      if (!integration) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Integration not found',
        })
      }

      return {
        id: integration.id,
        provider: integration.provider,
        enabled: integration.enabled,
        email: integration.email,
        name: integration.name,
        lastSyncedAt: integration.lastSyncedAt,
        lastSuccessfulSync: integration.lastSuccessfulSync,
        lastAuthError: integration.lastAuthError,
        lastAuthErrorAt: integration.lastAuthErrorAt,
        requiresReauth: integration.requiresReauth ?? false,
      }
    }),

  /**
   * Get authentication status for multiple integrations
   * Uses proper database fields instead of metadata
   */
  getMultipleAuthStatus: protectedProcedure
    .input(
      z.object({
        integrationIds: z.array(z.string()).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session

      const where = {
        organizationId,
        ...(input.integrationIds && { id: { in: input.integrationIds } }),
      }

      const integrations = await ctx.db
        .select({
          id: schema.Integration.id,
          provider: schema.Integration.provider,
          enabled: schema.Integration.enabled,
          email: schema.Integration.email,
          name: schema.Integration.name,
          lastSyncedAt: schema.Integration.lastSyncedAt,
          lastSuccessfulSync: schema.Integration.lastSuccessfulSync,
          lastAuthError: schema.Credential.lastAuthError,
          lastAuthErrorAt: schema.Credential.lastAuthErrorAt,
          requiresReauth: schema.Credential.requiresReauth,
        })
        .from(schema.Integration)
        .leftJoin(schema.Credential, eq(schema.Credential.id, schema.Integration.credentialId))
        .where(
          and(
            eq(schema.Integration.organizationId, organizationId),
            isNull(schema.Integration.deletedAt),
            ...(input.integrationIds ? [inArray(schema.Integration.id, input.integrationIds)] : [])
          )
        )

      return integrations.map((integration) => ({
        id: integration.id,
        provider: integration.provider,
        enabled: integration.enabled,
        email: integration.email,
        name: integration.name,
        lastSyncedAt: integration.lastSyncedAt,
        lastSuccessfulSync: integration.lastSuccessfulSync,
        lastAuthError: integration.lastAuthError,
        lastAuthErrorAt: integration.lastAuthErrorAt,
        requiresReauth: integration.requiresReauth ?? false,
      }))
    }),
})
