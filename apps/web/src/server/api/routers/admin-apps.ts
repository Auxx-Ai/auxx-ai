// apps/web/src/server/api/routers/admin-apps.ts

import { database, schema } from '@auxx/database'
import { AdminService } from '@auxx/lib/admin'
import {
  invalidateAppCatalog,
  invalidateOrgsByAppId,
  invalidateOrgsByDeploymentId,
  onCacheEvent,
  resolveAppSlug,
} from '@auxx/lib/cache'
import {
  adminApproveDeployment,
  adminDeleteDeployment,
  adminDeprecateDeployment,
  adminRejectDeployment,
} from '@auxx/services/app-versions'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { createTRPCRouter, superAdminProcedure } from '~/server/api/trpc'
import { invalidateBuildCacheForDeveloperAccount } from '~/server/lib/invalidate-build-cache'

const connectionDefinitionSchema = z.object({
  connectionType: z.string(),
  label: z.string(),
  description: z.string().nullable(),
  global: z.boolean().nullable(),
  major: z.number(),
  oauth2AuthorizeUrl: z.string().nullable(),
  oauth2AccessTokenUrl: z.string().nullable(),
  oauth2ClientId: z.string().nullable(),
  oauth2Scopes: z.array(z.string()).nullable(),
  oauth2TokenRequestAuthMethod: z.string().nullable(),
  oauth2RefreshTokenIntervalSeconds: z.number().nullable(),
  oauth2Features: z.record(z.string(), z.unknown()).nullable(),
})

const appSchema = z.object({
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  scopes: z.array(z.string()).nullable(),
  hasOauth: z.boolean().nullable(),
  hasBundle: z.boolean().nullable(),
  publicationStatus: z.string(),
  reviewStatus: z.string().nullable(),
  autoApprove: z.boolean(),
  verified: z.boolean().optional(),
  overview: z.string().nullable(),
  contentOverview: z.string().nullable(),
  contentHowItWorks: z.string().nullable(),
  contentConfigure: z.string().nullable(),
  websiteUrl: z.string().nullable(),
  documentationUrl: z.string().nullable(),
  contactUrl: z.string().nullable(),
  supportSiteUrl: z.string().nullable(),
  termsOfServiceUrl: z.string().nullable(),
  oauthExternalEntrypointUrl: z.string().nullable(),
  oauthApplication: z
    .object({
      clientId: z.string(),
      name: z.string(),
      redirectURLs: z.string(),
      type: z.string(),
    })
    .nullable(),
  connectionDefinitions: z.array(connectionDefinitionSchema),
  latestDeployment: z.any().nullable(),
})

const exportDataSchema = z.object({
  exportVersion: z.string(),
  exportedAt: z.string(),
  developerAccount: z.object({
    slug: z.string(),
    title: z.string(),
    featureFlags: z.record(z.string(), z.unknown()).nullable(),
  }),
  apps: z.array(appSchema),
})

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
        developerAccountId: z.string().optional(),
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

      await invalidateOrgsByDeploymentId(input.deploymentId, database)
      await invalidateAppCatalog()

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

      await invalidateOrgsByDeploymentId(input.deploymentId, database)
      await invalidateAppCatalog()

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

      await invalidateOrgsByDeploymentId(input.deploymentId, database)
      await invalidateAppCatalog()

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
      // Query affected orgs BEFORE delete — the fan-out helper queries
      // AppInstallation.currentDeploymentId which won't match after the deployment is gone
      const affectedOrgs = await database.query.AppInstallation.findMany({
        where: (t, { eq, and, isNull }) =>
          and(eq(t.currentDeploymentId, input.deploymentId), isNull(t.uninstalledAt)),
        columns: { organizationId: true },
      })

      const result = await adminDeleteDeployment({
        deploymentId: input.deploymentId,
        adminUserId: ctx.session.user.id,
      })

      if (result.isErr()) {
        throw new Error(result.error.message)
      }

      // Fan-out invalidation using the pre-queried org IDs
      const orgIds = [...new Set(affectedOrgs.map((a) => a.organizationId))]
      await Promise.all(orgIds.map((orgId) => onCacheEvent('app.deployment.changed', { orgId })))
      await invalidateAppCatalog()

      return { success: true }
    }),

  /**
   * Export all apps for a developer account as portable JSON
   */
  exportByDeveloperAccount: superAdminProcedure
    .input(
      z.object({
        developerAccountId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.exportByDeveloperAccount(input.developerAccountId)
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

  /**
   * Toggle verified badge for an app
   */
  toggleVerified: superAdminProcedure
    .input(
      z.object({
        appId: z.string(),
        verified: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      await adminService.toggleVerified(input.appId, input.verified)

      return { success: true }
    }),

  /**
   * Validate an export JSON for import (check slug availability)
   */
  validateImport: superAdminProcedure
    .input(
      z.object({
        exportData: exportDataSchema,
        targetDeveloperAccountId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      return adminService.validateImport(input.exportData, input.targetDeveloperAccountId)
    }),

  /**
   * Import apps from an export JSON with upsert logic
   */
  importApps: superAdminProcedure
    .input(
      z.object({
        exportData: exportDataSchema,
        targetDeveloperAccountId: z.string(),
        selectedSlugs: z.array(z.string()),
        slugOverrides: z.record(z.string(), z.string()),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const adminService = new AdminService(ctx.db)
      const result = await adminService.importApps(input.exportData, ctx.session.user.id, {
        targetDeveloperAccountId: input.targetDeveloperAccountId,
        selectedSlugs: input.selectedSlugs,
        slugOverrides: input.slugOverrides,
      })

      // Invalidate app catalog first so cache is fresh for slug resolution below
      await invalidateAppCatalog()

      // Invalidate installedApps for all orgs that have any imported app installed
      // (connection definitions may have changed during import)
      for (const app of result.apps) {
        if (app.connectionDefinitions.length > 0) {
          const appId = await resolveAppSlug(app.slug)
          if (appId) {
            await invalidateOrgsByAppId(appId, database)
          }
        }
      }

      return result
    }),

  /**
   * Unpublish an app (set publication status to 'unpublished')
   */
  unpublishApp: superAdminProcedure
    .input(
      z.object({
        appId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(schema.App)
        .set({ publicationStatus: 'unpublished', updatedAt: new Date() })
        .where(eq(schema.App.id, input.appId))

      await invalidateAppCatalog()

      return { success: true }
    }),
})
