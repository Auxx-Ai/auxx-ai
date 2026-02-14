// ~/server/api/routers/integration-reauth.ts

import { schema } from '@auxx/database'
import {
  FacebookOAuthService,
  GoogleOAuthService,
  InstagramOAuthService,
  OutlookOAuthService,
} from '@auxx/lib/providers'
import { TRPCError } from '@trpc/server'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'

/**
 * Integration re-authentication router
 * Handles OAuth re-authentication flows and banner management
 */
export const integrationReauthRouter = createTRPCRouter({
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
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session

      // Verify integration exists and user has access
      const [integration] = await ctx.db
        .select()
        .from(schema.Integration)
        .where(
          and(
            eq(schema.Integration.id, input.integrationId),
            eq(schema.Integration.organizationId, organizationId)
          )
        )
        .limit(1)

      if (!integration) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Integration not found',
        })
      }

      // Generate OAuth URL using existing services with re-auth options
      let authUrl: string

      try {
        switch (integration.provider) {
          case 'google': {
            const googleOAuthService = GoogleOAuthService.getInstance()
            authUrl = googleOAuthService.getAuthUrl(organizationId, userId, {
              integrationId: integration.id,
              isReauth: true,
              type: 'reauth',
            })
            break
          }

          case 'outlook': {
            const outlookOAuthService = OutlookOAuthService.getInstance()
            authUrl = await outlookOAuthService.getAuthUrl(organizationId, userId, {
              integrationId: integration.id,
              isReauth: true,
              type: 'reauth',
            })
            break
          }

          case 'facebook': {
            const facebookOAuthService = FacebookOAuthService.getInstance()
            authUrl = await facebookOAuthService.getAuthUrl(organizationId, userId, {
              integrationId: integration.id,
              isReauth: true,
              type: 'reauth',
            })
            break
          }

          case 'instagram': {
            const instagramOAuthService = InstagramOAuthService.getInstance()
            authUrl = instagramOAuthService.getAuthUrl(organizationId, userId, {
              integrationId: integration.id,
              isReauth: true,
              type: 'reauth',
            })
            break
          }

          default:
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: `Re-authentication not supported for provider: ${integration.provider}`,
            })
        }
      } catch (error: any) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to generate re-authentication URL: ${error.message}`,
        })
      }

      return {
        success: true,
        authUrl,
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
            eq(schema.Integration.organizationId, organizationId)
          )
        )
        .limit(1)

      if (!integration) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Integration not found',
        })
      }

      // Clear the requiresReauth flag to dismiss the banner
      // Keep the auth error details for debugging but hide the banner
      await ctx.db
        .update(schema.Integration)
        .set({
          requiresReauth: false,
        })
        .where(eq(schema.Integration.id, input.integrationId))

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
          authStatus: schema.Integration.authStatus,
          lastAuthError: schema.Integration.lastAuthError,
          lastAuthErrorAt: schema.Integration.lastAuthErrorAt,
          requiresReauth: schema.Integration.requiresReauth,
        })
        .from(schema.Integration)
        .where(
          and(
            eq(schema.Integration.id, input.integrationId),
            eq(schema.Integration.organizationId, organizationId)
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
        authStatus: integration.authStatus,
        lastAuthError: integration.lastAuthError,
        lastAuthErrorAt: integration.lastAuthErrorAt,
        requiresReauth: integration.requiresReauth,
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
          authStatus: schema.Integration.authStatus,
          lastAuthError: schema.Integration.lastAuthError,
          lastAuthErrorAt: schema.Integration.lastAuthErrorAt,
          requiresReauth: schema.Integration.requiresReauth,
        })
        .from(schema.Integration)
        .where(
          and(
            eq(schema.Integration.organizationId, organizationId),
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
        authStatus: integration.authStatus,
        lastAuthError: integration.lastAuthError,
        lastAuthErrorAt: integration.lastAuthErrorAt,
        requiresReauth: integration.requiresReauth,
      }))
    }),
})
