// apps/build/src/server/api/routers/connections.ts
// Connections tRPC router

import { App, ConnectionDefinition, DeveloperAccountMember } from '@auxx/database'
import { invalidateOrgsByAppId } from '@auxx/lib/cache'
import { TRPCError } from '@trpc/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'

/**
 * Connections router
 */
export const connectionsRouter = createTRPCRouter({
  /**
   * List all connection definitions for an app
   */
  list: protectedProcedure.input(z.object({ appId: z.string() })).query(async ({ ctx, input }) => {
    const [app] = await ctx.db.select().from(App).where(eq(App.id, input.appId)).limit(1)
    if (!app) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'App not found' })
    }

    const [member] = await ctx.db
      .select()
      .from(DeveloperAccountMember)
      .where(
        and(
          eq(DeveloperAccountMember.developerAccountId, app.developerAccountId),
          eq(DeveloperAccountMember.userId, ctx.session.userId)
        )
      )
      .limit(1)

    if (!member) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this app' })
    }

    return ctx.db
      .select()
      .from(ConnectionDefinition)
      .where(eq(ConnectionDefinition.appId, input.appId))
  }),

  /**
   * Get connection definition for an app version
   */
  get: protectedProcedure
    .input(
      z.object({
        appId: z.string(),
        version: z.number(),
        global: z.boolean(),
      })
    )
    .query(async ({ ctx, input }) => {
      // Verify user has access to the app
      const [app] = await ctx.db.select().from(App).where(eq(App.id, input.appId)).limit(1)

      if (!app) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'App not found',
        })
      }

      // Verify membership
      const [member] = await ctx.db
        .select()
        .from(DeveloperAccountMember)
        .where(
          and(
            eq(DeveloperAccountMember.developerAccountId, app.developerAccountId),
            eq(DeveloperAccountMember.userId, ctx.session.userId)
          )
        )
        .limit(1)

      if (!member) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You do not have access to this app',
        })
      }

      // Get connection definition
      const [connection] = await ctx.db
        .select()
        .from(ConnectionDefinition)
        .where(
          and(
            eq(ConnectionDefinition.appId, input.appId),
            eq(ConnectionDefinition.major, input.version),
            eq(ConnectionDefinition.global, input.global)
          )
        )
        .limit(1)

      return connection || null
    }),

  /**
   * Create or update connection definition
   */
  upsert: protectedProcedure
    .input(
      z.object({
        appId: z.string(),
        version: z.number(),
        global: z.boolean(),
        connectionType: z.enum(['oauth2-code', 'secret', 'none']),
        label: z.string(),
        description: z.string().optional(),
        oauth2AuthorizeUrl: z.string().optional(),
        oauth2AccessTokenUrl: z.string().optional(),
        oauth2ClientId: z.string().optional(),
        oauth2ClientSecret: z.string().optional(),
        oauth2Scopes: z
          .array(z.string())
          .optional()
          .transform((scopes) => {
            if (!scopes) return scopes
            // Normalize: split entries that contain commas or whitespace into individual scopes
            return scopes
              .flatMap((s) => s.split(/[\s,]+/))
              .map((s) => s.trim())
              .filter((s) => s.length > 0)
          }),
        oauth2TokenRequestAuthMethod: z.enum(['request-body', 'basic-auth']).optional(),
        oauth2RefreshTokenIntervalSeconds: z.number().optional(),
        oauth2Features: z
          .object({
            pkce: z.boolean().optional(),
            callbackBaseUrl: z.string().optional(),
            additionalAuthorizeParams: z.record(z.string(), z.string()).optional(),
            additionalTokenParams: z.record(z.string(), z.string()).optional(),
            scopeSeparator: z.string().optional(),
            callbackMetadataParams: z.array(z.string()).optional(),
            connectionVariables: z
              .array(
                z.object({
                  key: z.string(),
                  label: z.string(),
                  description: z.string().optional(),
                  placeholder: z.string().optional(),
                  required: z.boolean().optional(),
                  secret: z.boolean().optional(),
                })
              )
              .optional(),
          })
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify user has access to the app
      const [app] = await ctx.db.select().from(App).where(eq(App.id, input.appId)).limit(1)

      if (!app) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'App not found',
        })
      }

      // Verify membership
      const [member] = await ctx.db
        .select()
        .from(DeveloperAccountMember)
        .where(
          and(
            eq(DeveloperAccountMember.developerAccountId, app.developerAccountId),
            eq(DeveloperAccountMember.userId, ctx.session.userId)
          )
        )
        .limit(1)

      if (!member) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You do not have access to this app',
        })
      }

      // Check if connection exists
      const [existing] = await ctx.db
        .select()
        .from(ConnectionDefinition)
        .where(
          and(
            eq(ConnectionDefinition.appId, input.appId),
            eq(ConnectionDefinition.major, input.version),
            eq(ConnectionDefinition.global, input.global)
          )
        )
        .limit(1)

      // Prepare data
      const data = {
        developerAccountId: app.developerAccountId,
        appId: input.appId,
        major: input.version,
        global: input.global,
        connectionType: input.connectionType,
        label: input.label,
        description: input.description,
        oauth2AuthorizeUrl: input.oauth2AuthorizeUrl,
        oauth2AccessTokenUrl: input.oauth2AccessTokenUrl,
        oauth2ClientId: input.oauth2ClientId,
        oauth2ClientSecret: input.oauth2ClientSecret,
        oauth2Scopes: input.oauth2Scopes || [],
        oauth2TokenRequestAuthMethod: input.oauth2TokenRequestAuthMethod || 'request-body',
        oauth2RefreshTokenIntervalSeconds: input.oauth2RefreshTokenIntervalSeconds,
        oauth2Features: input.oauth2Features ?? {},
        createdById: ctx.session.userId,
      }

      let result
      if (existing) {
        // Update existing connection
        const [updated] = await ctx.db
          .update(ConnectionDefinition)
          .set({
            ...data,
            updatedAt: new Date(),
          })
          .where(eq(ConnectionDefinition.id, existing.id))
          .returning()

        result = updated
      } else {
        // Create new connection
        const [created] = await ctx.db.insert(ConnectionDefinition).values(data).returning()

        result = created
      }

      await invalidateOrgsByAppId(input.appId, ctx.db)

      return result
    }),
})
