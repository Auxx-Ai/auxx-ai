// ~/server/api/routers/channel-reauth.ts

import { schema } from '@auxx/database'
import { TRPCError } from '@trpc/server'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'

/**
 * Channel re-authentication router
 * Handles OAuth re-authentication flows and banner management
 */
export const channelReauthRouter = createTRPCRouter({
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
   *
   * Also resolves the reconnect target (`credentialId` + `connectionDefinitionId`/`providerKey`,
   * one join away via `Integration.credentialId -> Credential.connectionDefinitionId ->
   * ConnectionDefinition.providerKey`) so `useChannelReconnect` can build a `useConnectFlow`
   * `platform` target without a bespoke authorize-URL builder.
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
          credentialId: schema.Integration.credentialId,
          connectionDefinitionId: schema.Credential.connectionDefinitionId,
          providerKey: schema.ConnectionDefinition.providerKey,
        })
        .from(schema.Integration)
        .leftJoin(schema.Credential, eq(schema.Credential.id, schema.Integration.credentialId))
        .leftJoin(
          schema.ConnectionDefinition,
          eq(schema.ConnectionDefinition.id, schema.Credential.connectionDefinitionId)
        )
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
        credentialId: integration.credentialId,
        connectionDefinitionId: integration.connectionDefinitionId,
        providerKey: integration.providerKey,
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
