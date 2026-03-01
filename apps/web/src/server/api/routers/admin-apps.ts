// apps/web/src/server/api/routers/admin-apps.ts

import { database } from '@auxx/database'
import { AdminService } from '@auxx/lib/admin'
import {
  adminApproveDeployment,
  adminDeleteDeployment,
  adminDeprecateDeployment,
  adminRejectDeployment,
} from '@auxx/services/app-versions'
import { z } from 'zod'
import { createTRPCRouter, superAdminProcedure } from '~/server/api/trpc'
import { invalidateBuildCacheForDeveloperAccount } from '~/server/lib/invalidate-build-cache'

/**
 * Admin apps router for managing marketplace apps
 */
export const adminAppsRouter = createTRPCRouter({
  /**
   * Get all apps with filters
   */
  getApps: superAdminProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(100),
        offset: z.number().min(0).default(0),
        search: z.string().optional(),
        publicationStatus: z.enum(['unpublished', 'published']).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.getApps(input)
    }),

  /**
   * Get single app details with deployments
   */
  getApp: superAdminProcedure
    .input(
      z.object({
        id: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.getApp(input.id)
    }),

  /**
   * Delete app
   */
  deleteApp: superAdminProcedure
    .input(
      z.object({
        id: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      await adminService.deleteApp(input.id)
      return { success: true }
    }),

  /**
   * Approve deployment (sets status to 'approved' or 'published' with autoPublish)
   */
  approveDeployment: superAdminProcedure
    .input(
      z.object({
        deploymentId: z.string(),
        autoPublish: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await adminApproveDeployment({
        deploymentId: input.deploymentId,
        adminUserId: ctx.session.user.id,
        autoPublish: input.autoPublish,
      })

      if (result.isErr()) {
        throw new Error(result.error.message)
      }

      // Get app to invalidate developer cache
      const deployment = await database.query.AppDeployment.findFirst({
        where: (deployments, { eq }) => eq(deployments.id, input.deploymentId),
        with: { app: true },
      })

      if (deployment?.app?.developerAccountId) {
        await invalidateBuildCacheForDeveloperAccount(deployment.app.developerAccountId)
      }

      return { success: true }
    }),

  /**
   * Reject deployment (sets status to 'rejected')
   */
  rejectDeployment: superAdminProcedure
    .input(
      z.object({
        deploymentId: z.string(),
        reason: z.string().min(10, 'Rejection reason must be at least 10 characters'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await adminRejectDeployment({
        deploymentId: input.deploymentId,
        reason: input.reason,
        adminUserId: ctx.session.user.id,
      })

      if (result.isErr()) {
        throw new Error(result.error.message)
      }

      // Get app to invalidate developer cache
      const deployment = await database.query.AppDeployment.findFirst({
        where: (deployments, { eq }) => eq(deployments.id, input.deploymentId),
        with: { app: true },
      })

      if (deployment?.app?.developerAccountId) {
        await invalidateBuildCacheForDeveloperAccount(deployment.app.developerAccountId)
      }

      return { success: true }
    }),

  /**
   * Deprecate deployment (published → deprecated)
   */
  deprecateDeployment: superAdminProcedure
    .input(
      z.object({
        deploymentId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await adminDeprecateDeployment({
        deploymentId: input.deploymentId,
        adminUserId: ctx.session.user.id,
      })

      if (result.isErr()) {
        throw new Error(result.error.message)
      }

      // Get app to invalidate developer cache
      const deployment = await database.query.AppDeployment.findFirst({
        where: (deployments, { eq }) => eq(deployments.id, input.deploymentId),
        with: { app: true },
      })

      if (deployment?.app?.developerAccountId) {
        await invalidateBuildCacheForDeveloperAccount(deployment.app.developerAccountId)
      }

      return { success: true }
    }),

  /**
   * Delete deployment
   */
  deleteDeployment: superAdminProcedure
    .input(
      z.object({
        deploymentId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await adminDeleteDeployment({
        deploymentId: input.deploymentId,
        adminUserId: ctx.session.user.id,
      })

      if (result.isErr()) {
        throw new Error(result.error.message)
      }

      return { success: true }
    }),

  /**
   * Toggle auto-approve for an app
   */
  toggleAutoApprove: superAdminProcedure
    .input(
      z.object({
        appId: z.string(),
        autoApprove: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      await adminService.toggleAutoApprove(input.appId, input.autoApprove)

      return { success: true }
    }),
})
