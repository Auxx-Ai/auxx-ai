// apps/build/src/server/api/routers/versions.ts
// Versions tRPC router

import { createScopedLogger } from '@auxx/logger'
import {
  listProdVersions,
  updateVersionLifecycleStatus,
  updateVersionPublicationStatus,
} from '@auxx/services/app-versions'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { BuildDehydrationService } from '~/lib/dehydration'
import { createTRPCRouter, protectedProcedure } from '../trpc'

const logger = createScopedLogger('trpc-build-versions')

/**
 * Versions router
 */
export const versionsRouter = createTRPCRouter({
  /**
   * List versions for an app
   */
  list: protectedProcedure.input(z.object({ appId: z.string() })).query(async ({ ctx, input }) => {
    const result = await listProdVersions({ appId: input.appId })

    if (result.isErr()) {
      const error = result.error
      logger.error('Failed to list production versions', { error, appId: input.appId })

      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: error.message,
      })
    }

    return result.value
  }),

  /**
   * Create new version
   */
  create: protectedProcedure
    .input(
      z.object({
        appId: z.string(),
        major: z.number(),
        minor: z.number().optional(),
        patch: z.number().optional(),
        releaseNotes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // TODO: Implement
      return null
    }),

  /**
   * Update version publication status
   * Actions: submit-for-review, withdraw, publish, unpublish
   */
  updatePublicationStatus: protectedProcedure
    .input(
      z.object({
        versionId: z.string(),
        action: z.enum(['submit-for-review', 'withdraw', 'publish', 'unpublish']),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await updateVersionPublicationStatus({
        versionId: input.versionId,
        userId: ctx.session.userId,
        action: input.action,
      })

      if (result.isErr()) {
        const error = result.error
        logger.error('Failed to update version publication status', {
          error,
          versionId: input.versionId,
          action: input.action,
        })

        throw new TRPCError({
          code:
            error.code === 'VERSION_NOT_FOUND'
              ? 'NOT_FOUND'
              : error.code === 'VERSION_ACCESS_DENIED'
                ? 'FORBIDDEN'
                : error.code === 'VERSION_NOT_PROD' ||
                    error.code === 'VERSION_IS_LAST_PUBLISHED' ||
                    error.code === 'VERSION_INVALID_STATE' ||
                    error.code === 'VERSION_ALREADY_PUBLISHED' ||
                    error.code === 'VERSION_NOT_PUBLISHED' ||
                    error.code === 'VERSION_NOT_APPROVED' ||
                    error.code === 'INVALID_ACTION'
                  ? 'BAD_REQUEST'
                  : 'INTERNAL_SERVER_ERROR',
          message: error.message,
        })
      }

      // Invalidate cache
      const dehydrationService = new BuildDehydrationService(ctx.db)
      const versionWithApp = await ctx.db.query.AppVersion.findFirst({
        where: (versions, { eq }) => eq(versions.id, input.versionId),
        with: { app: true },
      })
      if (versionWithApp?.app) {
        await dehydrationService.invalidateDeveloperAccount(versionWithApp.app.developerAccountId)
      }

      return result.value
    }),

  /**
   * Update version lifecycle status
   */
  updateLifecycleStatus: protectedProcedure
    .input(
      z.object({
        versionId: z.string(),
        status: z.enum(['draft', 'active', 'deprecated']),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await updateVersionLifecycleStatus({
        versionId: input.versionId,
        userId: ctx.session.userId,
        status: input.status,
      })

      if (result.isErr()) {
        const error = result.error
        logger.error('Failed to update version lifecycle status', {
          error,
          versionId: input.versionId,
          status: input.status,
        })

        throw new TRPCError({
          code:
            error.code === 'VERSION_NOT_FOUND'
              ? 'NOT_FOUND'
              : error.code === 'VERSION_ACCESS_DENIED'
                ? 'FORBIDDEN'
                : error.code === 'INVALID_LIFECYCLE_TRANSITION'
                  ? 'BAD_REQUEST'
                  : 'INTERNAL_SERVER_ERROR',
          message: error.message,
        })
      }

      // Invalidate cache
      const dehydrationService = new BuildDehydrationService(ctx.db)
      const versionWithApp = await ctx.db.query.AppVersion.findFirst({
        where: (versions, { eq }) => eq(versions.id, input.versionId),
        with: { app: true },
      })
      if (versionWithApp?.app) {
        await dehydrationService.invalidateDeveloperAccount(versionWithApp.app.developerAccountId)
      }

      return result.value
    }),
})
