// apps/build/src/server/api/routers/apps.ts
// Apps tRPC router

import { WEBAPP_URL } from '@auxx/config/urls'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import {
  checkAppSlugExists,
  checkSlugInputSchema,
  createApp,
  generateClientSecret,
  getDeveloperApp,
  registerAppAsOAuthClient,
  unregisterAppOAuthClient,
  updateApp,
  updateAppPublicationStatus,
  updateOAuthRedirectUris,
} from '@auxx/services/apps'
import { TRPCError } from '@trpc/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { BuildDehydrationService } from '~/lib/dehydration'
import { createTRPCRouter, protectedProcedure } from '../trpc'

const logger = createScopedLogger('trpc-build-apps')

/**
 * Apps router
 */
export const appsRouter = createTRPCRouter({
  /**
   * Check if app slug exists
   */
  slugExists: protectedProcedure.input(checkSlugInputSchema).query(async ({ input }) => {
    const result = await checkAppSlugExists({ slug: input.slug })

    if (result.isErr()) {
      const error = result.error
      logger.error('Failed to check slug exists', { error, slug: input.slug })

      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: error.message,
      })
    }

    return result.value
  }),

  /**
   * Get app by slug
   */
  get: protectedProcedure.input(z.object({ slug: z.string() })).query(async ({ ctx, input }) => {
    const result = await getDeveloperApp({
      slug: input.slug,
      userId: ctx.session.userId,
    })

    if (result.isErr()) {
      const error = result.error
      logger.error('Failed to get developer app', { error, slug: input.slug })

      throw new TRPCError({
        code:
          error.code === 'APP_NOT_FOUND'
            ? 'NOT_FOUND'
            : error.code === 'DEVELOPER_ACCESS_DENIED'
              ? 'FORBIDDEN'
              : 'INTERNAL_SERVER_ERROR',
        message: error.message,
      })
    }

    return result.value
  }),

  /**
   * Create app
   */
  create: protectedProcedure
    .input(
      z.object({
        developerSlug: z.string(),
        id: z.string().optional(),
        slug: z.string().min(3),
        title: z.string().min(1),
        avatarId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await createApp({
        developerAccountSlug: input.developerSlug,
        userId: ctx.session.userId,
        id: input.id,
        slug: input.slug,
        title: input.title,
        avatarId: input.avatarId,
      })

      if (result.isErr()) {
        const error = result.error
        logger.error('Failed to create app', { error, slug: input.slug })

        throw new TRPCError({
          code:
            error.code === 'APP_SLUG_TAKEN'
              ? 'CONFLICT'
              : error.code === 'DEVELOPER_ACCOUNT_NOT_FOUND'
                ? 'NOT_FOUND'
                : error.code === 'DEVELOPER_ACCESS_DENIED'
                  ? 'FORBIDDEN'
                  : 'INTERNAL_SERVER_ERROR',
          message: error.message,
        })
      }

      // Invalidate cache for all members of the developer account
      const dehydrationService = new BuildDehydrationService(ctx.db)
      await dehydrationService.invalidateDeveloperAccount(result.value.app.developerAccountId)

      return result.value
    }),

  /**
   * Update app
   */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        // Basic info
        title: z.string().min(1).optional(),
        description: z.string().optional(),
        category: z
          .enum([
            'analytics',
            'autonomous',
            'billing',
            'calling',
            'customer-support',
            'communication',
            'forms-survey',
            'product-management',
          ])
          .optional(),

        // Content
        overview: z.string().optional(),
        contentOverview: z.string().optional(),
        contentHowItWorks: z.string().optional(),
        contentConfigure: z.string().optional(),

        // Links
        websiteUrl: z.string().url().optional().or(z.literal('')),
        documentationUrl: z.string().url().optional().or(z.literal('')),
        contactUrl: z.string().optional().or(z.literal('')),
        supportSiteUrl: z.string().url().optional().or(z.literal('')),
        termsOfServiceUrl: z.string().url().optional().or(z.literal('')),

        // Avatar
        avatarUrl: z.string().url().optional(),

        // Other
        hasOauth: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input

      const result = await updateApp({
        appId: id,
        userId: ctx.session.userId,
        data,
      })

      if (result.isErr()) {
        const error = result.error
        logger.error('Failed to update app', { error, appId: id })

        throw new TRPCError({
          code:
            error.code === 'APP_NOT_FOUND'
              ? 'NOT_FOUND'
              : error.code === 'DEVELOPER_ACCESS_DENIED'
                ? 'FORBIDDEN'
                : 'INTERNAL_SERVER_ERROR',
          message: error.message,
        })
      }

      // Invalidate cache for all members of the developer account
      const dehydrationService = new BuildDehydrationService(ctx.db)
      await dehydrationService.invalidateDeveloperAccount(result.value.app.developerAccountId)

      return result.value
    }),

  /**
   * Update app publication status
   */
  updatePublicationStatus: protectedProcedure
    .input(
      z.object({
        appId: z.string(),
        targetStatus: z.enum(['private', 'review', 'published']),
        force: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await updateAppPublicationStatus({
        appId: input.appId,
        userId: ctx.session.userId,
        targetStatus: input.targetStatus,
        force: input.force,
      })

      if (result.isErr()) {
        const error = result.error
        logger.error('Failed to update app publication status', {
          error,
          appId: input.appId,
          targetStatus: input.targetStatus,
        })

        throw new TRPCError({
          code:
            error.code === 'APP_NOT_FOUND'
              ? 'NOT_FOUND'
              : error.code === 'DEVELOPER_ACCESS_DENIED'
                ? 'FORBIDDEN'
                : error.code === 'INVALID_STATUS_TRANSITION' ||
                    error.code === 'APP_NOT_ELIGIBLE_FOR_REVIEW' ||
                    error.code === 'APP_HAS_ACTIVE_INSTALLATIONS' ||
                    error.code === 'APP_LISTING_INCOMPLETE' ||
                    error.code === 'APP_OAUTH_CONFIG_INCOMPLETE' ||
                    error.code === 'APP_NO_PROD_VERSION'
                  ? 'BAD_REQUEST'
                  : 'INTERNAL_SERVER_ERROR',
          message: error.message,
        })
      }

      // Invalidate cache for all members of the developer account
      const dehydrationService = new BuildDehydrationService(ctx.db)
      await dehydrationService.invalidateDeveloperAccount(result.value.app.developerAccountId)

      return result.value
    }),

  /**
   * Get OAuth credentials for an app
   */
  getOAuthCredentials: protectedProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ ctx, input }) => {
      const app = await ctx.db.query.App.findFirst({
        where: (apps, { eq }) => eq(apps.slug, input.slug),
        with: {
          oauthApplication: true,
        },
      })

      if (!app) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'App not found',
        })
      }

      // TODO: Check permission - only app owner/developer account can view

      if (!app.hasOauth || !app.oauthApplication) {
        return {
          hasOauth: false,
          clientId: null,
          clientSecret: null,
          redirectUris: [],
          installUrl: null,
          scopes: [],
          authorizationEndpoint: null,
          tokenEndpoint: null,
          userInfoEndpoint: null,
        }
      }

      const redirectUris = app.oauthApplication.redirectURLs
        ? app.oauthApplication.redirectURLs.split(',').map((u) => u.trim())
        : []

      return {
        hasOauth: true,
        clientId: app.oauthApplication.clientId,
        clientSecret: app.oauthApplication.clientSecret,
        redirectUris,
        installUrl: app.oauthExternalEntrypointUrl,
        scopes: (app.scopes as string[]) || [],

        // OAuth endpoints
        authorizationEndpoint: `${WEBAPP_URL}/oauth2/authorize`,
        tokenEndpoint: `${WEBAPP_URL}/oauth2/token`,
        userInfoEndpoint: `${WEBAPP_URL}/oauth2/userinfo`,
      }
    }),

  /**
   * Enable OAuth for an app (creates OAuth application)
   */
  enableOAuth: protectedProcedure
    .input(
      z.object({
        slug: z.string(),
        redirectUris: z.array(z.string().url()).min(1),
        externalEntrypointUrl: z.string().url(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const app = await ctx.db.query.App.findFirst({
        where: (apps, { eq }) => eq(apps.slug, input.slug),
      })

      if (!app) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'App not found',
        })
      }

      // TODO: Check permission

      if (app.oauthApplicationId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'OAuth already enabled for this app',
        })
      }

      // Register as OAuth client
      const result = await registerAppAsOAuthClient({
        appId: app.id,
        appSlug: app.slug,
        appTitle: app.title,
        redirectUris: input.redirectUris,
        scopes: (app.scopes as string[]) || [],
      })

      if (result.isErr()) {
        const error = result.error
        logger.error('Failed to register OAuth app', { error, appId: app.id })

        throw new TRPCError({
          code:
            error.code === 'APP_NOT_FOUND'
              ? 'NOT_FOUND'
              : error.code === 'OAUTH_ALREADY_ENABLED'
                ? 'BAD_REQUEST'
                : 'INTERNAL_SERVER_ERROR',
          message: error.message,
        })
      }

      // Update app
      await ctx.db
        .update(schema.App)
        .set({
          hasOauth: true,
          oauthExternalEntrypointUrl: input.externalEntrypointUrl,
          updatedAt: new Date(),
        })
        .where(eq(schema.App.id, app.id))

      // Invalidate cache
      const dehydrationService = new BuildDehydrationService(ctx.db)
      await dehydrationService.invalidateDeveloperAccount(app.developerAccountId)

      return result.value
    }),

  /**
   * Disable OAuth for an app
   */
  disableOAuth: protectedProcedure
    .input(z.object({ slug: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const app = await ctx.db.query.App.findFirst({
        where: (apps, { eq }) => eq(apps.slug, input.slug),
      })

      if (!app) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'App not found',
        })
      }

      // TODO: Check permission

      if (!app.oauthApplicationId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'OAuth not enabled for this app',
        })
      }

      // Unregister OAuth client
      const result = await unregisterAppOAuthClient(app.id)

      if (result.isErr()) {
        const error = result.error
        logger.error('Failed to unregister OAuth app', { error, appId: app.id })

        throw new TRPCError({
          code:
            error.code === 'APP_NOT_FOUND'
              ? 'NOT_FOUND'
              : error.code === 'OAUTH_NOT_ENABLED'
                ? 'BAD_REQUEST'
                : 'INTERNAL_SERVER_ERROR',
          message: error.message,
        })
      }

      // Update app
      await ctx.db
        .update(schema.App)
        .set({
          hasOauth: false,
          updatedAt: new Date(),
        })
        .where(eq(schema.App.id, app.id))

      // Invalidate cache
      const dehydrationService = new BuildDehydrationService(ctx.db)
      await dehydrationService.invalidateDeveloperAccount(app.developerAccountId)

      return { success: true }
    }),

  /**
   * Update OAuth redirect URIs
   */
  updateOAuthRedirectUris: protectedProcedure
    .input(
      z.object({
        slug: z.string(),
        redirectUris: z.array(z.string().url()).min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const app = await ctx.db.query.App.findFirst({
        where: (apps, { eq }) => eq(apps.slug, input.slug),
      })

      if (!app) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'App not found',
        })
      }

      // TODO: Check permission

      if (!app.oauthApplicationId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'OAuth not enabled for this app',
        })
      }

      const result = await updateOAuthRedirectUris(app.oauthApplicationId, input.redirectUris)

      if (result.isErr()) {
        const error = result.error
        logger.error('Failed to update OAuth redirect URIs', { error, appId: app.id })

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message,
        })
      }

      // Invalidate cache
      const dehydrationService = new BuildDehydrationService(ctx.db)
      await dehydrationService.invalidateDeveloperAccount(app.developerAccountId)

      return { success: true }
    }),

  /**
   * Update OAuth install URL
   */
  updateOAuthInstallUrl: protectedProcedure
    .input(
      z.object({
        slug: z.string(),
        installUrl: z.string().url(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const app = await ctx.db.query.App.findFirst({
        where: (apps, { eq }) => eq(apps.slug, input.slug),
      })

      if (!app) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'App not found',
        })
      }

      // TODO: Check permission

      if (!app.oauthApplicationId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'OAuth not enabled for this app',
        })
      }

      // Update install URL
      await ctx.db
        .update(schema.App)
        .set({
          oauthExternalEntrypointUrl: input.installUrl,
          updatedAt: new Date(),
        })
        .where(eq(schema.App.id, app.id))

      // Invalidate cache
      const dehydrationService = new BuildDehydrationService(ctx.db)
      await dehydrationService.invalidateDeveloperAccount(app.developerAccountId)

      return { success: true }
    }),

  /**
   * Regenerate OAuth client secret
   */
  regenerateOAuthClientSecret: protectedProcedure
    .input(z.object({ slug: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const app = await ctx.db.query.App.findFirst({
        where: (apps, { eq }) => eq(apps.slug, input.slug),
      })

      if (!app) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'App not found',
        })
      }

      // TODO: Check permission

      if (!app.oauthApplicationId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'OAuth not enabled for this app',
        })
      }

      // Generate new client secret
      const newClientSecret = generateClientSecret()

      // Update oauthApplication with new secret
      await ctx.db
        .update(schema.oauthApplication)
        .set({
          clientSecret: newClientSecret,
          updatedAt: new Date(),
        })
        .where(eq(schema.oauthApplication.id, app.oauthApplicationId))

      // Invalidate cache
      const dehydrationService = new BuildDehydrationService(ctx.db)
      await dehydrationService.invalidateDeveloperAccount(app.developerAccountId)

      return { clientSecret: newClientSecret }
    }),
})
