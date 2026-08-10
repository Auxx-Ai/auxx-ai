// apps/web/src/server/api/routers/setting.ts

import { getOrgCache, getUserCache, onCacheEvent } from '@auxx/lib/cache'
import { BadRequestError } from '@auxx/lib/errors'
import { PermissionKey, requirePermission } from '@auxx/lib/permissions'
import {
  batchUpdateOrganizationSettings,
  isSettingKey,
  resetUserSetting,
  SETTINGS_CATALOG,
  type SettingKey,
  updateOrganizationSetting,
  updateUserSetting,
} from '@auxx/lib/settings'
import { createScopedLogger } from '@auxx/logger'
import { z } from 'zod'
import { recordAuditFromCtx } from '~/server/api/audit-context'
import { createTRPCRouter, notDemo, protectedProcedure } from '~/server/api/trpc'

const logger = createScopedLogger('api-settings')

/**
 * Catalog keys this generic door refuses, because a dedicated router owns their
 * authorization and this one only ever asks for `settings.manage`.
 *
 * `mailClassificationInboxIds` is the mail-classification opt-in
 * (`plans/mail-filter/05-mail-classification-plan.md` §5). It is authored
 * PER INBOX — a personal mailbox by its owner alone, a shared one with
 * `automationRules.manage` + inbox `admin` — and §5 states outright that "a
 * personal mailbox must never be opted in by an admin". Leaving it writable
 * here would hand any `settings.manage` holder a one-call "classify
 * everything", which is precisely what per-inbox storage exists to make
 * inexpressible. `mailClassification.setInboxEnabled` is the only door.
 */
const ROUTER_OWNED_ORG_SETTING_KEYS = new Set<string>(['mailClassificationInboxIds'])

function assertNotRouterOwned(key: string): void {
  if (ROUTER_OWNED_ORG_SETTING_KEYS.has(key)) {
    throw new BadRequestError(
      `Setting ${key} is managed per inbox and cannot be changed from organization settings.`
    )
  }
}

// Input validation schema for getting user settings
const getUserSettingSchema = z.object({
  key: z.string(),
})

// Input validation schema for updating an organization setting
const updateOrgSettingSchema = z.object({
  key: z.string(),
  value: z.any(),
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
  settings: z.array(z.object({ key: z.string(), value: z.any() })),
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
    if (!isSettingKey(key)) {
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
        if (isSettingKey(key) && SETTINGS_CATALOG[key].scope === input.scope) {
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
      const { key, value } = input
      if (!isSettingKey(key)) {
        throw new BadRequestError(`Unknown setting: ${key}`)
      }
      assertNotRouterOwned(key)
      // Capability gate, not role (plan 21 §4.2): settingsManage is what a
      // profile turns off.
      await requirePermission(userId, organizationId, PermissionKey.settingsManage)

      await updateOrganizationSetting({ organizationId, key, value, db: ctx.db })

      await onCacheEvent('org.settings.changed', { orgId: organizationId, broadcastUserKeys: true })

      await recordAuditFromCtx(ctx, {
        category: 'settings',
        action: 'setting.changed',
        targetType: 'OrganizationSetting',
        targetId: key,
        newState: { value },
      })

      return { success: true }
    }),

  // Update a user setting
  updateUserSetting: protectedProcedure
    .input(updateUserSettingSchema)
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const { key, value } = input
      if (!isSettingKey(key)) {
        throw new BadRequestError(`Unknown setting: ${key}`)
      }

      await updateUserSetting({ userId, organizationId, key, value, db: ctx.db })

      await onCacheEvent('user.settings.changed', { orgId: organizationId, userId })

      return { success: true }
    }),

  // Reset a user setting to organization default
  resetUserSetting: protectedProcedure
    .input(resetUserSettingSchema)
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const { key } = input
      if (!isSettingKey(key)) {
        throw new BadRequestError(`Unknown setting: ${key}`)
      }
      await resetUserSetting({ userId, organizationId, key, db: ctx.db })

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
          access: metadata.access,
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
      // Capability gate, not role (plan 21 §4.2).
      await requirePermission(userId, organizationId, PermissionKey.settingsManage)

      const unknownKey = settings.find((s) => !isSettingKey(s.key))
      if (unknownKey) {
        throw new BadRequestError(`Unknown setting: ${unknownKey.key}`)
      }
      for (const setting of settings) assertNotRouterOwned(setting.key)

      await batchUpdateOrganizationSettings({
        organizationId,
        settings: settings as Array<{ key: SettingKey; value: any }>,
        db: ctx.db,
      })

      await onCacheEvent('org.settings.changed', { orgId: organizationId, broadcastUserKeys: true })

      await recordAuditFromCtx(ctx, {
        category: 'settings',
        action: 'setting.batch_changed',
        targetType: 'OrganizationSetting',
        newState: { keys: settings.map((s) => s.key) },
        metadata: { count: settings.length },
      })

      return { success: true }
    }),
})
