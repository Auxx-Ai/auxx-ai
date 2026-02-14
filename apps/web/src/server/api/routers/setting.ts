import { OrganizationMemberModel } from '@auxx/database/models'
import { DehydrationService } from '@auxx/lib/dehydration'
import { SETTINGS_CATALOG, SettingsService } from '@auxx/lib/settings'
import { createScopedLogger } from '@auxx/logger'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'

const logger = createScopedLogger('api-settings')

// Input validation schema for getting user settings
const getUserSettingSchema = z.object({
  key: z.string(),
  // organizationId: z.string(),
})

// Input validation schema for updating an organization setting
const updateOrgSettingSchema = z.object({
  key: z.string(),
  value: z.any(),
  allowUserOverride: z.boolean(),
  // organizationId: z.string(),
})

// Input validation schema for updating a user setting
const updateUserSettingSchema = z.object({
  key: z.string(),
  value: z.any(),
  // organizationId: z.string(),
})

// Input validation schema for resetting a user setting
const resetUserSettingSchema = z.object({
  key: z.string(),
  // organizationId: z.string(),
})

// Input validation schema for getting settings by scope
const getScopeSettingsSchema = z.object({
  scope: z.string().optional(),
  // organizationId: z.string(),
})

// Input validation schema for batch updating organization settings
const batchUpdateOrgSettingsSchema = z.object({
  // organizationId: z.string(),
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

    const settingsService = new SettingsService(ctx.db)
    return await settingsService.getUserSetting({ userId, organizationId, key })
  }),

  // Get all user settings, optionally filtered by scope
  getAllUserSettings: protectedProcedure
    .input(getScopeSettingsSchema)
    .query(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const { scope } = input
      const settingsService = new SettingsService(ctx.db)
      return await settingsService.getAllUserSettings({ userId, organizationId, scope })
    }),

  // Update an organization setting
  updateOrganizationSetting: protectedProcedure
    .input(updateOrgSettingSchema)
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const { key, value, allowUserOverride } = input
      // Check permission via model: only owners and admins can update org settings
      const memberModel = new OrganizationMemberModel(organizationId)
      const allowedRes = await memberModel.isAdminOrOwner(userId)
      if (!allowedRes.ok || !allowedRes.value) {
        throw new Error('You do not have permission to update organization settings')
      }

      const settingsService = new SettingsService(ctx.db)
      await settingsService.updateOrganizationSetting({
        organizationId,
        key,
        value,
        allowUserOverride,
      })

      // Invalidate cache for all members of the organization
      const dehydrationService = new DehydrationService(ctx.db)
      await dehydrationService.invalidateOrganizationMembers(organizationId)

      return { success: true }
    }),

  // Update a user setting
  updateUserSetting: protectedProcedure
    .input(updateUserSettingSchema)
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const { key, value } = input
      // First check if user is a member of the organization
      const memberModel = new OrganizationMemberModel(organizationId)
      const memberRes = await memberModel.findMemberByUser(userId)
      if (!memberRes.ok || !memberRes.value) {
        throw new Error('You are not a member of this organization')
      }
      logger.info('Updating user setting', { userId, organizationId, key, value })
      const settingsService = new SettingsService(ctx.db)
      await settingsService.updateUserSetting({ userId, organizationId, key, value })

      // Invalidate cache for the user
      const dehydrationService = new DehydrationService(ctx.db)
      await dehydrationService.invalidateUser(userId)

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

      // Invalidate cache for the user
      const dehydrationService = new DehydrationService(ctx.db)
      await dehydrationService.invalidateUser(userId)

      return { success: true }
    }),

  // Get all organization settings with metadata
  getOrganizationSettingsWithMetadata: protectedProcedure
    .input(getScopeSettingsSchema)
    .query(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const { scope } = input
      // First check if user has permission to view org settings
      const memberModel = new OrganizationMemberModel(organizationId)
      const memberRes = await memberModel.findMemberByUser(userId)
      if (!memberRes.ok || !memberRes.value) {
        throw new Error('You are not a member of this organization')
      }

      const settingsService = new SettingsService(ctx.db)
      return await settingsService.getOrganizationSettingsWithMetadata({ organizationId, scope })
    }),

  // Batch update organization settings
  batchUpdateOrganizationSettings: protectedProcedure
    .input(batchUpdateOrgSettingsSchema)
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const { settings } = input
      // Check permission via model: only owners and admins can update org settings
      const memberModel = new OrganizationMemberModel(organizationId)
      const allowedRes = await memberModel.isAdminOrOwner(userId)
      if (!allowedRes.ok || !allowedRes.value) {
        throw new Error('You do not have permission to update organization settings')
      }

      const settingsService = new SettingsService(ctx.db)
      await settingsService.batchUpdateOrganizationSettings({ organizationId, settings })

      // Invalidate cache for all members of the organization
      const dehydrationService = new DehydrationService(ctx.db)
      await dehydrationService.invalidateOrganizationMembers(organizationId)

      return { success: true }
    }),
})
