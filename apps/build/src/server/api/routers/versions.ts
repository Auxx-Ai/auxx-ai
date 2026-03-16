// apps/build/src/server/api/routers/versions.ts

import { invalidateOrgsByDeploymentId } from '@auxx/lib/cache'
import { createScopedLogger } from '@auxx/logger'
import {
  calculateNextVersion,
  listDeployments,
  promoteToProduction,
  updateDeploymentStatus,
} from '@auxx/services/app-versions'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { BuildDehydrationService } from '~/lib/dehydration'
import { createTRPCRouter, protectedProcedure } from '../trpc'

const logger = createScopedLogger('trpc-build-versions')

/**
 * Versions router (now manages deployments)
 */
export const versionsRouter = createTRPCRouter({
  /**
   * List deployments for an app
   */
  list: protectedProcedure
    .input(
      z.object({
        appId: z.string(),
        deploymentType: z.enum(['development', 'production']).optional(),
      })
    )
    .query(async ({ input }) => {
      const result = await listDeployments({
        appId: input.appId,
        deploymentType: input.deploymentType,
      })

      if (result.isErr()) {
        const error = result.error
        logger.error('Failed to list deployments', { error, appId: input.appId })

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message,
        })
      }

      return result.value
    }),

  /**
   * Update deployment status
   * Actions: submit-for-review, withdraw, publish, deprecate
   */
  updateDeploymentStatus: protectedProcedure
    .input(
      z.object({
        deploymentId: z.string(),
        action: z.enum(['submit-for-review', 'withdraw', 'publish', 'deprecate']),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await updateDeploymentStatus({
        deploymentId: input.deploymentId,
        userId: ctx.session.userId,
        action: input.action,
      })

      if (result.isErr()) {
        const error = result.error
        logger.error('Failed to update deployment status', {
          error,
          deploymentId: input.deploymentId,
          action: input.action,
        })

        throw new TRPCError({
          code:
            error.code === 'DEPLOYMENT_NOT_FOUND'
              ? 'NOT_FOUND'
              : error.code === 'DEVELOPER_ACCESS_DENIED'
                ? 'FORBIDDEN'
                : error.code === 'INVALID_STATUS_TRANSITION' ||
                    error.code === 'INVALID_ACTION' ||
                    error.code === 'APP_REVIEW_ALREADY_IN_PROGRESS' ||
                    error.code === 'MULTIPLE_DEPLOYMENTS_IN_REVIEW'
                  ? 'BAD_REQUEST'
                  : 'INTERNAL_SERVER_ERROR',
          message: error.message,
        })
      }

      // Invalidate cache
      const dehydrationService = new BuildDehydrationService(ctx.db)
      const deploymentWithApp = await ctx.db.query.AppDeployment.findFirst({
        where: (deployments, { eq }) => eq(deployments.id, input.deploymentId),
        with: { app: true },
      })
      if (deploymentWithApp?.app) {
        await dehydrationService.invalidateDeveloperAccount(
          deploymentWithApp.app.developerAccountId
        )
      }

      await invalidateOrgsByDeploymentId(input.deploymentId, ctx.db)

      return result.value
    }),

  /**
   * Get the next auto-calculated version for an app
   */
  nextVersion: protectedProcedure
    .input(z.object({ appId: z.string() }))
    .query(async ({ input }) => {
      return calculateNextVersion(input.appId)
    }),

  /**
   * Promote a development deployment to production
   */
  promoteToProduction: protectedProcedure
    .input(
      z.object({
        deploymentId: z.string(),
        version: z.string().optional(),
        releaseNotes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await promoteToProduction({
        sourceDeploymentId: input.deploymentId,
        userId: ctx.session.userId,
        version: input.version,
        releaseNotes: input.releaseNotes,
      })

      if (result.isErr()) {
        const error = result.error
        logger.error('Failed to promote deployment', {
          error,
          deploymentId: input.deploymentId,
        })

        throw new TRPCError({
          code:
            error.code === 'DEPLOYMENT_NOT_FOUND'
              ? 'NOT_FOUND'
              : error.code === 'INVALID_DEPLOYMENT_TYPE'
                ? 'BAD_REQUEST'
                : 'INTERNAL_SERVER_ERROR',
          message: error.message,
        })
      }

      // Invalidate cache
      const dehydrationService = new BuildDehydrationService(ctx.db)
      const deploymentWithApp = await ctx.db.query.AppDeployment.findFirst({
        where: (deployments, { eq }) => eq(deployments.id, result.value.id),
        with: { app: true },
      })
      if (deploymentWithApp?.app) {
        await dehydrationService.invalidateDeveloperAccount(
          deploymentWithApp.app.developerAccountId
        )
      }

      return result.value
    }),
})
