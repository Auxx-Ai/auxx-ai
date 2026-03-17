// apps/web/src/server/api/routers/apps.ts

import { getAppDeployments, getAppWithInstallationStatus, getAvailableApps } from '@auxx/lib/apps'
import { getCachedAppBySlug, getOrgCache, onCacheEvent } from '@auxx/lib/cache'
import { createScopedLogger } from '@auxx/logger'
import {
  deleteAppConnection,
  listAppConnections,
  renameAppConnection,
  saveAppConnection,
} from '@auxx/services/app-connections'
import { getAppSettings, saveAppSettings, schemaToZod } from '@auxx/services/app-settings'
import {
  installApp,
  installAppRequestSchema,
  listAppsQuerySchema,
  listDeploymentsQuerySchema,
  listInstalledAppsQuerySchema,
  uninstallApp,
  uninstallAppRequestSchema,
} from '@auxx/services/apps'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { adminProcedure, createTRPCRouter, protectedProcedure } from '~/server/api/trpc'

const logger = createScopedLogger('trpc-apps')

/**
 * Apps router
 * Provides tRPC procedures for app marketplace operations
 */
export const appsRouter = createTRPCRouter({
  /**
   * List all available apps for the organization
   * Includes both private dev apps and public marketplace apps
   */
  list: protectedProcedure.input(listAppsQuerySchema).query(async ({ ctx, input }) => {
    const { organizationId } = ctx.session
    const { category, search, limit, offset } = input

    return getAvailableApps({
      organizationId,
      db: ctx.db,
      filters: {
        category,
        searchQuery: search,
      },
      pagination: {
        limit,
        offset,
      },
    })
  }),

  /**
   * List installed apps for the organization (cached)
   */
  listInstalled: protectedProcedure
    .input(listInstalledAppsQuerySchema)
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const orgCache = getOrgCache()
      const { installedApps } = await orgCache.getOrRecompute(organizationId, ['installedApps'])

      // Apply type filter if provided
      const filtered = input.type
        ? installedApps.filter((a) => a.installationType === input.type)
        : installedApps

      // Rehydrate dates for SuperJSON compatibility
      const installations = filtered.map((app) => ({
        ...app,
        installedAt: new Date(app.installedAt),
        currentDeployment: app.currentDeployment
          ? { ...app.currentDeployment, createdAt: new Date(app.currentDeployment.createdAt) }
          : null,
      }))

      return { installations }
    }),

  /**
   * Get app details with installation status
   */
  getBySlug: protectedProcedure
    .input(z.object({ appSlug: z.string() }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const { appSlug } = input

      const result = await getAppWithInstallationStatus({
        appSlug,
        organizationId,
        db: ctx.db,
      })

      if (!result.ok) {
        const error = result.error
        logger.error('Failed to get app details', { error, appSlug, organizationId })

        throw new TRPCError({
          code: error.code === 'APP_NOT_FOUND' ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR',
          message: error.message,
        })
      }

      return result.value
    }),

  /**
   * Install an app (requires ADMIN or OWNER role)
   */
  install: adminProcedure
    .input(
      z
        .object({
          appSlug: z.string(),
        })
        .merge(installAppRequestSchema)
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const { appSlug, type, deploymentId } = input

      // Resolve slug from cache
      const cachedApp = await getCachedAppBySlug(appSlug)
      if (!cachedApp) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `App "${appSlug}" not found` })
      }

      const result = await installApp({
        appId: cachedApp.id,
        organizationId,
        installationType: type!,
        deploymentId,
        installedById: userId,
      })

      if (result.isErr()) {
        const error = result.error
        logger.error('Failed to install app', { error, appSlug, organizationId })

        throw new TRPCError({
          code:
            error.code === 'APP_NOT_FOUND'
              ? 'NOT_FOUND'
              : error.code === 'APP_ACCESS_DENIED'
                ? 'CONFLICT'
                : 'INTERNAL_SERVER_ERROR',
          message: error.message,
        })
      }

      await onCacheEvent('app.installed', { orgId: organizationId })

      return result.value
    }),

  /**
   * Uninstall an app (requires ADMIN or OWNER role)
   */
  uninstall: adminProcedure
    .input(
      z
        .object({
          appSlug: z.string(),
        })
        .merge(uninstallAppRequestSchema)
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const { appSlug, type } = input

      // Resolve slug from cache
      const cachedApp = await getCachedAppBySlug(appSlug)
      if (!cachedApp) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `App "${appSlug}" not found` })
      }

      const result = await uninstallApp({
        appId: cachedApp.id,
        organizationId,
        uninstalledById: userId,
        installationType: type,
      })

      if (result.isErr()) {
        const error = result.error
        logger.error('Failed to uninstall app', { error, appSlug, organizationId })

        throw new TRPCError({
          code: error.code === 'APP_NOT_FOUND' ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR',
          message: error.message,
        })
      }

      await onCacheEvent('app.uninstalled', { orgId: organizationId })

      return result.value
    }),

  /**
   * List available deployments for an app
   */
  listDeployments: protectedProcedure
    .input(
      z
        .object({
          appSlug: z.string(),
        })
        .merge(listDeploymentsQuerySchema)
    )
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const { appSlug, deploymentType, status } = input

      const result = await getAppDeployments({
        appSlug,
        organizationId,
        db: ctx.db,
        filters: {
          deploymentType,
          status,
        },
      })

      if (!result.ok) {
        const error = result.error
        logger.error('Failed to get app deployments', { error, appSlug, organizationId })

        throw new TRPCError({
          code: error.code === 'APP_NOT_FOUND' ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR',
          message: error.message,
        })
      }

      return result.value
    }),

  /**
   * List app connections for organization
   * Returns both user-specific and organization-wide connections
   */
  listConnections: protectedProcedure.query(async ({ ctx }) => {
    const { organizationId } = ctx.session

    // Don't pass userId to get all connections (both user and org-wide)
    const result = await listAppConnections(organizationId)

    if (result.isErr()) {
      logger.error('Failed to list app connections', {
        error: result.error,
        organizationId,
      })

      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: result.error.message,
      })
    }

    return result.value
  }),

  /**
   * Delete an app connection
   */
  deleteConnection: protectedProcedure
    .input(
      z.object({
        credentialId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const { credentialId } = input

      const result = await deleteAppConnection(credentialId, organizationId)

      if (result.isErr()) {
        logger.error('Failed to delete app connection', {
          error: result.error,
          credentialId,
          organizationId,
        })

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: result.error.message,
        })
      }

      return { success: true }
    }),

  /**
   * Save secret-based connection (API key)
   */
  saveSecretConnection: protectedProcedure
    .input(
      z.object({
        appId: z.string(),
        installationId: z.string(),
        appName: z.string(),
        connectionType: z.enum(['user', 'organization']),
        secret: z.string().min(1, 'Secret is required'),
        connectionId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const { appId, installationId, appName, connectionType, secret, connectionId } = input

      // userId is null for organization-wide, userId for user-specific
      const userIdField = connectionType === 'organization' ? null : userId

      const result = await saveAppConnection(
        appId,
        installationId,
        appName,
        organizationId,
        userId, // createdById
        userIdField, // userId field for scoping
        { secret },
        { connectionId }
      )

      if (result.isErr()) {
        logger.error('Failed to save secret connection', {
          error: result.error,
          appId,
          organizationId,
        })

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: result.error.message || 'Failed to save connection',
        })
      }

      return { success: true, credentialId: result.value }
    }),

  /**
   * Rename an app connection's label
   */
  renameConnection: protectedProcedure
    .input(
      z.object({
        connectionId: z.string(),
        label: z.string().min(1).max(100),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const { connectionId, label } = input

      const result = await renameAppConnection(connectionId, label, organizationId)

      if (result.isErr()) {
        logger.error('Failed to rename connection', {
          error: result.error,
          connectionId,
          organizationId,
        })

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: result.error.message,
        })
      }

      return { success: true }
    }),

  /**
   * Get app's settings schema
   * Returns the schema definition from the app version
   */
  getSettingsSchema: protectedProcedure
    .input(
      z.object({
        appSlug: z.string(),
        installationType: z.enum(['development', 'production']),
      })
    )
    .query(async ({ ctx, input }) => {
      const { appSlug, installationType } = input
      const { organizationId } = ctx.session

      // Get app installation
      const appResult = await getAppWithInstallationStatus({
        appSlug,
        organizationId,
        db: ctx.db,
      })

      if (!appResult.ok) {
        logger.error('Failed to get app for schema', {
          error: appResult.error,
          appSlug,
          organizationId,
        })

        throw new TRPCError({
          code: appResult.error.code === 'APP_NOT_FOUND' ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR',
          message: appResult.error.message,
        })
      }

      const app = appResult.value

      // Verify app is installed
      if (!app.installation.isInstalled) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'App not installed',
        })
      }

      // Verify installation type matches
      if (app.installation.installationType !== installationType) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `App is installed as ${app.installation.installationType}, not ${installationType}`,
        })
      }

      // Get deployment
      if (!app.installation.currentDeploymentId) {
        return {} // No schema if no deployment
      }

      const deployment = await ctx.db.query.AppDeployment.findFirst({
        where: (d, { eq }) => eq(d.id, app.installation.currentDeploymentId!),
        columns: {
          settingsSchema: true,
        },
      })

      // Return the settings schema from AppDeployment.settingsSchema
      return deployment?.settingsSchema?.organization || {}
    }),

  /**
   * Get app settings (for rendering form)
   * Returns settings merged with schema defaults
   */
  getSettings: protectedProcedure
    .input(
      z.object({
        appSlug: z.string(),
        installationType: z.enum(['development', 'production']),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const { appSlug, installationType } = input

      // Get app installation
      const appResult = await getAppWithInstallationStatus({
        appSlug,
        organizationId,
        db: ctx.db,
      })

      if (!appResult.ok) {
        logger.error('Failed to get app for settings', {
          error: appResult.error,
          appSlug,
          organizationId,
        })

        throw new TRPCError({
          code: appResult.error.code === 'APP_NOT_FOUND' ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR',
          message: appResult.error.message,
        })
      }

      const app = appResult.value

      // Verify app is installed
      if (!app.installation.isInstalled) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'App not installed',
        })
      }

      // Verify installation type matches
      if (app.installation.installationType !== installationType) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `App is installed as ${app.installation.installationType}, not ${installationType}`,
        })
      }

      // Load schema from deployment for default merging
      let schema
      if (app.installation.currentDeploymentId) {
        const deployment = await ctx.db.query.AppDeployment.findFirst({
          where: (d, { eq }) => eq(d.id, app.installation.currentDeploymentId!),
          columns: {
            settingsSchema: true,
          },
        })

        schema = deployment?.settingsSchema?.organization
      }

      // Get settings with schema for default merging
      const settingsResult = await getAppSettings({
        appInstallationId: app.installation.id!,
        schema,
      })

      if (settingsResult.isErr()) {
        logger.error('Failed to get app settings', {
          error: settingsResult.error,
          installationId: app.installation.id,
        })

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: settingsResult.error.message,
        })
      }

      return settingsResult.value
    }),

  /**
   * Save app settings (from form submission)
   * Validates on server-side before persisting
   */
  saveSettings: protectedProcedure
    .input(
      z.object({
        appSlug: z.string(),
        installationType: z.enum(['development', 'production']),
        settings: z.record(z.string(), z.any()),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const { appSlug, installationType, settings } = input

      // Get app installation
      const appResult = await getAppWithInstallationStatus({
        appSlug,
        organizationId,
        db: ctx.db,
      })

      if (!appResult.ok) {
        logger.error('Failed to get app for saving settings', {
          error: appResult.error,
          appSlug,
          organizationId,
        })

        throw new TRPCError({
          code: appResult.error.code === 'APP_NOT_FOUND' ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR',
          message: appResult.error.message,
        })
      }

      const app = appResult.value

      // Verify app is installed
      if (!app.installation.isInstalled) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'App not installed',
        })
      }

      // Verify installation type matches
      if (app.installation.installationType !== installationType) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `App is installed as ${app.installation.installationType}, not ${installationType}`,
        })
      }

      // Load schema for server-side validation
      let schema
      if (app.installation.currentDeploymentId) {
        const deployment = await ctx.db.query.AppDeployment.findFirst({
          where: (d, { eq }) => eq(d.id, app.installation.currentDeploymentId!),
          columns: {
            settingsSchema: true,
          },
        })

        schema = deployment?.settingsSchema?.organization
      }

      // SERVER-SIDE VALIDATION using Zod
      if (schema && Object.keys(schema).length > 0) {
        try {
          const zodSchema = schemaToZod(schema)
          const validationResult = zodSchema.safeParse(settings)

          if (!validationResult.success) {
            const errors = validationResult.error.flatten()
            logger.error('Settings validation failed', {
              errors,
              settings,
              appSlug,
              organizationId,
            })

            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Validation failed: Invalid settings provided',
              cause: errors,
            })
          }
        } catch (err) {
          // Handle schema conversion errors or validation errors
          if (err instanceof TRPCError) {
            throw err
          }

          logger.error('Settings validation error', {
            error: err,
            settings,
            schema,
            appSlug,
            organizationId,
          })

          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: err instanceof Error ? err.message : 'Invalid settings',
          })
        }
      }

      // Save settings (now validated)
      const saveResult = await saveAppSettings({
        appInstallationId: app.installation.id!,
        appDeploymentId: app.installation.currentDeploymentId ?? undefined,
        settings,
      })

      if (saveResult.isErr()) {
        logger.error('Failed to save app settings', {
          error: saveResult.error,
          installationId: app.installation.id,
        })

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: saveResult.error.message,
        })
      }

      return { success: true }
    }),
})
