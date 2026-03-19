// apps/web/src/server/api/routers/setting.ts

import { getOrgCache, getUserCache, onCacheEvent } from '@auxx/lib/cache'
import { isAdminOrOwner } from '@auxx/lib/members'
import { SETTINGS_CATALOG, SettingsService } from '@auxx/lib/settings'
import { createScopedLogger } from '@auxx/logger'
import { z } from 'zod'
import { createTRPCRouter, notDemo, protectedProcedure } from '~/server/api/trpc'

const logger = createScopedLogger('api-settings')

// Input validation schema for getting user settings
const getUserSettingSchema = z.object({
  key: z.string(),
})

// Input validation schema for updating an organization setting
const updateOrgSettingSchema = z.object({
  key: z.string(),
  value: z.any(),
  allowUserOverride: z.boolean(),
})

// Input validation schema for updating a user setting
const updateUserSettingSchema = z.object({
  key: z.string(),
  value: z.any(),
})

// Input validation schema for resetting a user setting
const resetUserSettingSchema = z.object({
  key: z.string(),
})

// Input validation schema for getting settings by scope
const getScopeSettingsSchema = z.object({
  scope: z.string().optional(),
})

// Input validation schema for batch updating organization settings
const batchUpdateOrgSettingsSchema = z.object({
  settings: z.array(z.object({ key: z.string(), value: z.any(), allowUserOverride: z.boolean() })),
})

export const settingsRouter = createTRPCRouter({
  // Get all available setting metadata from the catalog
  getSettingsCatalog: protectedProcedure.query(() => {
    return SETTINGS_CATALOG
  }),

  // Get a single user setting
  getUserSetting: protectedProcedure.input(getUserSettingSchema).query(async ({ ctx, input }) => {
    const { key } = input
    const { organizationId, userId } = ctx.session

    // Preserve existing contract: unknown keys return null
    if (!SETTINGS_CATALOG[key]) {
      logger.warn(`Unknown setting requested: ${key}`)
      return null
    }

    const allSettings = await getUserCache().get(userId, 'userSettings', organizationId)
    return allSettings[key] ?? SETTINGS_CATALOG[key]?.defaultValue ?? null
  }),

  // Get all user settings, optionally filtered by scope
  getAllUserSettings: protectedProcedure
    .input(getScopeSettingsSchema)
    .query(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const allSettings = await getUserCache().get(userId, 'userSettings', organizationId)

      if (!input.scope) return allSettings

      // Filter by scope using the catalog
      const result: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(allSettings)) {
        if (SETTINGS_CATALOG[key]?.scope === input.scope) {
          result[key] = value
        }
      }
      return result
    }),

  // Update an organization setting
  updateOrganizationSetting: protectedProcedure
    .input(updateOrgSettingSchema)
    .use(notDemo('change organization settings'))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const { key, value, allowUserOverride } = input
      // Check permission: only owners and admins can update org settings
      if (!(await isAdminOrOwner(organizationId, userId))) {
        throw new Error('You do not have permission to update organization settings')
      }

      const settingsService = new SettingsService(ctx.db)
      await settingsService.updateOrganizationSetting({
        organizationId,
        key,
        value,
        allowUserOverride,
      })

      await onCacheEvent('org.settings.changed', { orgId: organizationId, broadcastUserKeys: true })

      return { success: true }
    }),

  // Update a user setting
  updateUserSetting: protectedProcedure
    .input(updateUserSettingSchema)
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const { key, value } = input

      const settingsService = new SettingsService(ctx.db)
      await settingsService.updateUserSetting({ userId, organizationId, key, value })

      await onCacheEvent('user.settings.changed', { orgId: organizationId, userId })

      return { success: true }
    }),

  // Reset a user setting to organization default
  resetUserSetting: protectedProcedure
    .input(resetUserSettingSchema)
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const { key } = input
      const settingsService = new SettingsService(ctx.db)
      await settingsService.resetUserSetting({ userId, organizationId, key })

      await onCacheEvent('user.settings.changed', { orgId: organizationId, userId })

      return { success: true }
    }),

  // Get all organization settings with metadata (cache + catalog composition)
  getOrganizationSettingsWithMetadata: protectedProcedure
    .input(getScopeSettingsSchema)
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const { scope } = input

      const orgSettings = await getOrgCache().get(organizationId, 'orgSettings')

      return Object.entries(SETTINGS_CATALOG)
        .filter(([_, config]) => !scope || config.scope === scope)
        .map(([key, metadata]) => ({
          key,
          value: orgSettings[key] ?? metadata.defaultValue,
          allowUserOverride: !metadata.organizationOnly,
          metadata,
        }))
    }),

  // Batch update organization settings
  batchUpdateOrganizationSettings: protectedProcedure
    .input(batchUpdateOrgSettingsSchema)
    .use(notDemo('change organization settings'))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const { settings } = input
      // Check permission: only owners and admins can update org settings
      if (!(await isAdminOrOwner(organizationId, userId))) {
        throw new Error('You do not have permission to update organization settings')
      }

      const settingsService = new SettingsService(ctx.db)
      await settingsService.batchUpdateOrganizationSettings({ organizationId, settings })

      await onCacheEvent('org.settings.changed', { orgId: organizationId, broadcastUserKeys: true })

      return { success: true }
    }),
})
