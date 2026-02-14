// apps/web/src/server/api/routers/apps.ts

import { createScopedLogger } from '@auxx/logger'
import {
  deleteAppConnection,
  listAppConnections,
  saveAppConnection,
} from '@auxx/services/app-connections'
import { getInstalledApps } from '@auxx/services/app-installations'
import { getAppSettings, saveAppSettings, schemaToZod } from '@auxx/services/app-settings'
import {
  getAppVersions,
  getAppWithInstallationStatus,
  getAvailableApps,
  installApp,
  installAppRequestSchema,
  listAppsQuerySchema,
  listInstalledAppsQuerySchema,
  listVersionsQuerySchema,
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

    const result = await getAvailableApps({
      organizationId,
      filters: {
        category,
        searchQuery: search,
      },
      pagination: {
        limit,
        offset,
      },
    })

    if (result.isErr()) {
      const error = result.error
      logger.error('Failed to get available apps', { error, organizationId })

      throw new TRPCError({
        code: error.code === 'DATABASE_ERROR' ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR',
        message: error.message,
      })
    }

    return result.value
  }),

  /**
   * List installed apps for the organization
   */
  listInstalled: protectedProcedure
    .input(listInstalledAppsQuerySchema)
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session

      const result = await getInstalledApps({
        organizationId,
        filters: input.type ? { installationType: input.type } : undefined,
      })

      if (result.isErr()) {
        const error = result.error
        logger.error('Failed to get installed apps', { error, organizationId })

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message,
        })
      }

      return result.value
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
      })

      if (result.isErr()) {
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
      const { appSlug, type, versionId } = input

      const result = await installApp({
        appSlug,
        organizationId,
        installationType: type!,
        versionId,
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

      const result = await uninstallApp({
        appSlug,
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

      return result.value
    }),

  /**
   * List available versions for an app
   */
  listVersions: protectedProcedure
    .input(
      z
        .object({
          appSlug: z.string(),
        })
        .merge(listVersionsQuerySchema)
    )
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const { appSlug, type, status } = input

      const result = await getAppVersions({
        appSlug,
        organizationId,
        filters: {
          versionType: type,
          status,
        },
      })

      if (result.isErr()) {
        const error = result.error
        logger.error('Failed to get app versions', { error, appSlug, organizationId })

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
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const { appId, installationId, appName, connectionType, secret } = input

      // userId is null for organization-wide, userId for user-specific
      const userIdField = connectionType === 'organization' ? null : userId

      const result = await saveAppConnection(
        appId,
        installationId,
        appName,
        organizationId,
        userId, // createdById
        userIdField, // userId field for scoping
        { secret }
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
      })

      if (appResult.isErr()) {
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

      // Get app version
      if (!app.installation.currentVersionId) {
        return {} // No schema if no version
      }

      const version = await ctx.db.query.AppVersion.findFirst({
        where: (ver, { eq }) => eq(ver.id, app.installation.currentVersionId!),
        columns: {
          settingsSchema: true,
        },
      })

      // Return the settings schema from AppVersion.settingsSchema
      return version?.settingsSchema?.organization || {}
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
      })

      if (appResult.isErr()) {
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

      // Load schema from app version for default merging
      let schema
      if (app.installation.currentVersionId) {
        const version = await ctx.db.query.AppVersion.findFirst({
          where: (ver, { eq }) => eq(ver.id, app.installation.currentVersionId!),
          columns: {
            settingsSchema: true,
          },
        })

        schema = version?.settingsSchema?.organization
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
      })

      if (appResult.isErr()) {
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
      if (app.installation.currentVersionId) {
        const version = await ctx.db.query.AppVersion.findFirst({
          where: (ver, { eq }) => eq(ver.id, app.installation.currentVersionId!),
          columns: {
            settingsSchema: true,
          },
        })

        schema = version?.settingsSchema?.organization
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
        appVersionId: app.installation.currentVersionId ?? undefined,
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
