// apps/web/src/server/api/routers/admin-apps.ts

import { database } from '@auxx/database'
import { AdminService } from '@auxx/lib/admin'
import {
  adminApproveVersion,
  adminDeleteVersion,
  adminRejectVersion,
  adminUnpublishVersion,
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
        reviewStatus: z
          .enum(['pending-review', 'in-review', 'approved', 'rejected', 'withdrawn'])
          .optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.getApps(input)
    }),

  /**
   * Get single app details with versions
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
   * Approve version (sets reviewStatus to 'approved')
   * Note: Approval does not automatically publish. Use separate publish action.
   */
  approveVersion: superAdminProcedure
    .input(
      z.object({
        versionId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await adminApproveVersion({
        versionId: input.versionId,
        adminUserId: ctx.session.user.id,
      })

      if (result.isErr()) {
        throw new Error(result.error.message)
      }

      // Get app to invalidate developer cache
      const version = await database.query.AppVersion.findFirst({
        where: (versions, { eq }) => eq(versions.id, input.versionId),
        with: { app: true },
      })

      if (version?.app?.developerAccountId) {
        await invalidateBuildCacheForDeveloperAccount(version.app.developerAccountId)
      }

      return { success: true }
    }),

  /**
   * Reject version (sets reviewStatus to 'rejected')
   */
  rejectVersion: superAdminProcedure
    .input(
      z.object({
        versionId: z.string(),
        reason: z.string().min(10, 'Rejection reason must be at least 10 characters'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await adminRejectVersion({
        versionId: input.versionId,
        reason: input.reason,
        adminUserId: ctx.session.user.id,
      })

      if (result.isErr()) {
        throw new Error(result.error.message)
      }

      // Get app to invalidate developer cache
      const version = await database.query.AppVersion.findFirst({
        where: (versions, { eq }) => eq(versions.id, input.versionId),
        with: { app: true },
      })

      if (version?.app?.developerAccountId) {
        await invalidateBuildCacheForDeveloperAccount(version.app.developerAccountId)
      }

      return { success: true }
    }),

  /**
   * Unpublish version (published → unpublished)
   * Note: reviewStatus remains 'approved'
   */
  unpublishVersion: superAdminProcedure
    .input(
      z.object({
        versionId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await adminUnpublishVersion({
        versionId: input.versionId,
        adminUserId: ctx.session.user.id,
      })

      if (result.isErr()) {
        throw new Error(result.error.message)
      }

      // Get app to invalidate developer cache
      const version = await database.query.AppVersion.findFirst({
        where: (versions, { eq }) => eq(versions.id, input.versionId),
        with: { app: true },
      })

      if (version?.app?.developerAccountId) {
        await invalidateBuildCacheForDeveloperAccount(version.app.developerAccountId)
      }

      return { success: true }
    }),

  /**
   * Delete version
   */
  deleteVersion: superAdminProcedure
    .input(
      z.object({
        versionId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await adminDeleteVersion({
        versionId: input.versionId,
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
