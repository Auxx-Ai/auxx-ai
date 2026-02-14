// settings-service.ts
import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray } from 'drizzle-orm'
import type { SettingConfig, SettingValue } from './types'

// Define a type for setting values
const logger = createScopedLogger('settings-service')

export const sidebarSettings = {
  'sidebar.inboxes': {
    key: 'sidebar.inboxes',
    scope: 'SIDEBAR',
    defaultValue: {}, // Record of inbox IDs to visibility settings
    type: 'object',
    description: 'Visibility settings for shared inboxes',
  },
  'sidebar.inboxOrder': {
    key: 'sidebar.inboxOrder',
    scope: 'SIDEBAR',
    defaultValue: [], // Array of inbox IDs in order
    type: 'object',
    description: 'Order of shared inboxes in sidebar',
  },
  'sidebar.personalItems': {
    key: 'sidebar.personalItems',
    scope: 'SIDEBAR',
    defaultValue: [
      { id: 'inbox', name: 'Inbox', visible: true, order: 0 },
      { id: 'drafts', name: 'Drafts', visible: true, order: 1 },
      { id: 'sent', name: 'Sent', visible: true, order: 2 },
    ],
    type: 'object',
    description: 'Personal sidebar items visibility and order',
  },
  'sidebar.views': {
    key: 'sidebar.views',
    scope: 'SIDEBAR',
    defaultValue: {}, // Record of view IDs to visibility settings
    type: 'object',
    description: 'Visibility settings for mail views',
  },
  'sidebar.viewsOrder': {
    key: 'sidebar.viewsOrder',
    scope: 'SIDEBAR',
    defaultValue: [], // Array of view IDs in order
    type: 'object',
    description: 'Order of mail views in sidebar',
  },
  'sidebar.groupVisibility': {
    key: 'sidebar.groupVisibility',
    scope: 'SIDEBAR',
    defaultValue: { personal: true, views: true, shared: true },
    type: 'object',
    description: 'Visibility settings for sidebar groups (Me, Views, Shared)',
  },
  'sidebar.entities.order': {
    key: 'sidebar.entities.order',
    scope: 'SIDEBAR',
    defaultValue: [],
    type: 'object',
    description: 'Order of entity definitions in the Records sidebar',
  },
  'sidebar.entities.visibility': {
    key: 'sidebar.entities.visibility',
    scope: 'SIDEBAR',
    defaultValue: {},
    type: 'object',
    description: 'Visibility settings for entity definitions in the Records sidebar',
  },
  'sidebar.entities.groupVisible': {
    key: 'sidebar.entities.groupVisible',
    scope: 'SIDEBAR',
    defaultValue: true,
    type: 'boolean',
    description: 'Visibility of the Records group in sidebar',
  },
}

// Define a catalog of available settings with their metadata
export const SETTINGS_CATALOG: Record<string, SettingConfig> = {
  'appearance.logo': {
    key: 'appearance.logo',
    scope: 'APPEARANCE',
    defaultValue: '',
    type: 'image',
    description: 'Organization logo',
  },
  'appearance.primaryColor': {
    key: 'appearance.primaryColor',
    scope: 'APPEARANCE',
    defaultValue: '#4f46e5',
    type: 'color',
    description: 'Primary theme color',
  },
  'appearance.secondaryColor': {
    key: 'appearance.secondaryColor',
    scope: 'APPEARANCE',
    defaultValue: '#0ea5e9',
    type: 'color',
    description: 'Secondary theme color',
  },
  'appearance.font': {
    key: 'appearance.font',
    scope: 'APPEARANCE',
    defaultValue: 'Inter',
    type: 'font',
    description: 'Primary font family',
    options: [
      { label: 'Inter', value: 'Inter' },
      { label: 'Roboto', value: 'Roboto' },
      { label: 'Open Sans', value: 'Open Sans' },
      { label: 'Montserrat', value: 'Montserrat' },
    ],
  },
  'notification.emailDigest': {
    key: 'notification.emailDigest',
    scope: 'NOTIFICATION',
    defaultValue: true,
    type: 'boolean',
    description: 'Receive daily email digest',
  },
  'dashboard.defaultView': {
    key: 'dashboard.defaultView',
    scope: 'DASHBOARD',
    defaultValue: 'kanban',
    type: 'string',
    description: 'Default dashboard view',
    options: [
      { label: 'Kanban', value: 'kanban' },
      { label: 'List', value: 'list' },
      { label: 'Calendar', value: 'calendar' },
    ],
  },
  // New email domain settings (organization-only)
  'email.internalDomains': {
    key: 'email.internalDomains',
    scope: 'COMMUNICATION',
    defaultValue: [],
    type: 'object',
    description: 'List of domains considered internal to the organization',
    organizationOnly: true,
  },
  'email.partnerDomains': {
    key: 'email.partnerDomains',
    scope: 'COMMUNICATION',
    defaultValue: [],
    type: 'object',
    description: 'List of domains considered as partner domains',
    organizationOnly: true,
  },
  ...sidebarSettings,
}

export class SettingsService {
  constructor(private database = db) {}

  /**
   * Get an organization setting, ignoring user overrides
   */
  async getOrganizationSetting(params: {
    organizationId: string
    key: string
  }): Promise<SettingValue> {
    const { organizationId, key } = params

    // Check if the setting exists in the catalog
    const settingConfig = SETTINGS_CATALOG[key]
    if (!settingConfig) {
      throw new Error(`Unknown setting: ${key}`)
    }

    // Get organization setting
    const [orgSetting] = await this.database
      .select()
      .from(schema.OrganizationSetting)
      .where(
        and(
          eq(schema.OrganizationSetting.organizationId, organizationId),
          eq(schema.OrganizationSetting.key, key)
        )
      )
      .limit(1)

    // If no organization setting, return the default from catalog
    if (!orgSetting) {
      return settingConfig.defaultValue
    }

    // Return the organization setting
    return orgSetting.value as SettingValue
  }

  /**
   * Get all organization settings, ignoring user overrides
   */
  async getAllOrganizationSettings(params: {
    organizationId: string
    scope?: string
  }): Promise<Record<string, SettingValue>> {
    const { organizationId, scope } = params

    // Get all organization settings
    const orgSettings = await this.database
      .select()
      .from(schema.OrganizationSetting)
      .where(
        and(
          eq(schema.OrganizationSetting.organizationId, organizationId),
          ...(scope ? [eq(schema.OrganizationSetting.scope, scope as any)] : [])
        )
      )

    // Build the result object
    const result: Record<string, SettingValue> = {}

    // First, add all default values from the catalog
    Object.entries(SETTINGS_CATALOG).forEach(([key, config]) => {
      if (!scope || config.scope === scope) {
        result[key] = config.defaultValue
      }
    })

    // Then override with organization settings
    orgSettings.forEach((orgSetting) => {
      const key = orgSetting.key
      result[key] = orgSetting.value as SettingValue
    })

    return result
  }

  /**
   * Get a setting for a user, considering organization defaults and user overrides
   */
  async getUserSetting(params: {
    userId: string
    organizationId: string
    key: string
  }): Promise<SettingValue> {
    const { userId, organizationId, key } = params

    // First, check if the setting exists in the catalog
    const settingConfig = SETTINGS_CATALOG[key]
    if (!settingConfig) {
      // Return null for unknown settings instead of throwing
      logger.warn(`Unknown setting requested: ${key}`)
      return null
    }

    // Get organization setting
    const [orgSetting] = await this.database
      .select()
      .from(schema.OrganizationSetting)
      .where(
        and(
          eq(schema.OrganizationSetting.organizationId, organizationId),
          eq(schema.OrganizationSetting.key, key)
        )
      )
      .limit(1)

    // If no organization setting, return the default from catalog
    if (!orgSetting) {
      return settingConfig.defaultValue
    }

    // If this is an organization-only setting, ignore user overrides
    if (settingConfig.organizationOnly) {
      return orgSetting.value as SettingValue
    }

    // If user override exists and is allowed, return that
    if (orgSetting.allowUserOverride) {
      const [userSetting] = await this.database
        .select()
        .from(schema.UserSetting)
        .where(
          and(
            eq(schema.UserSetting.userId, userId),
            eq(schema.UserSetting.organizationSettingId, orgSetting.id)
          )
        )
        .limit(1)
      if (userSetting) return userSetting.value as SettingValue
    }

    // Otherwise return the organization setting
    return orgSetting.value as SettingValue
  }

  /**
   * Get all settings for a user, considering organization defaults and user overrides
   */
  async getAllUserSettings(params: {
    userId: string
    organizationId: string
    scope?: string
  }): Promise<Record<string, SettingValue>> {
    const { userId, organizationId, scope } = params

    // Get all organization settings
    const orgSettings = await this.database
      .select()
      .from(schema.OrganizationSetting)
      .where(
        and(
          eq(schema.OrganizationSetting.organizationId, organizationId),
          ...(scope ? [eq(schema.OrganizationSetting.scope, scope as any)] : [])
        )
      )

    const orgSettingIds = orgSettings.map((os) => os.id)
    const userSettings = orgSettingIds.length
      ? await this.database
          .select()
          .from(schema.UserSetting)
          .where(
            and(
              eq(schema.UserSetting.userId, userId),
              inArray(schema.UserSetting.organizationSettingId, orgSettingIds)
            )
          )
      : []
    const userMap = new Map<string, any>()
    for (const us of userSettings) userMap.set(us.organizationSettingId, us)

    // Build the result object
    const result: Record<string, SettingValue> = {}

    // First, add all default values from the catalog
    Object.entries(SETTINGS_CATALOG).forEach(([key, config]) => {
      if (!scope || config.scope === scope) {
        result[key] = config.defaultValue
      }
    })

    // Then override with organization settings and user settings where allowed
    orgSettings.forEach((orgSetting) => {
      const key = orgSetting.key
      const settingConfig = SETTINGS_CATALOG[key]

      // If organization-only setting, or no user override allowed, use org value
      if (settingConfig?.organizationOnly || !orgSetting.allowUserOverride) {
        result[key] = orgSetting.value as SettingValue
      }
      // Otherwise, use user setting if it exists
      else {
        const us = userMap.get(orgSetting.id)
        if (us) result[key] = us.value as SettingValue
        else result[key] = orgSetting.value as SettingValue
      }
    })

    return result
  }

  /**
   * Update an organization setting
   */
  async updateOrganizationSetting(params: {
    organizationId: string
    key: string
    value: SettingValue
    allowUserOverride: boolean
  }): Promise<void> {
    const { organizationId, key, value, allowUserOverride } = params

    // Check if the setting exists in the catalog
    const settingConfig = SETTINGS_CATALOG[key]
    if (!settingConfig) {
      throw new Error(`Unknown setting: ${key}`)
    }

    // If this is an organization-only setting, force allowUserOverride to false
    let effectiveAllowUserOverride = allowUserOverride
    if (settingConfig.organizationOnly && allowUserOverride) {
      logger.warn(`Setting ${key} is organization-only; ignoring allowUserOverride=true`)
      effectiveAllowUserOverride = false
    }

    // Validate the value type against the expected type
    this.validateSettingValue(value, settingConfig)

    // Upsert the organization setting
    await this.database
      .insert(schema.OrganizationSetting)
      .values({
        organizationId,
        key,
        value: value,
        allowUserOverride: effectiveAllowUserOverride,
        scope: settingConfig.scope,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [schema.OrganizationSetting.organizationId, schema.OrganizationSetting.key],
        set: {
          value: value,
          allowUserOverride: effectiveAllowUserOverride,
          updatedAt: new Date(),
        },
      })
  }

  /**
   * Update a user setting (only if allowed by the organization)
   * Auto-creates the organization setting if it doesn't exist
   */
  async updateUserSetting(params: {
    userId: string
    organizationId: string
    key: string
    value: SettingValue
  }): Promise<void> {
    const { userId, organizationId, key, value } = params

    // Check if the setting exists in the catalog
    const settingConfig = SETTINGS_CATALOG[key]
    if (!settingConfig) {
      throw new Error(`Unknown setting: ${key}`)
    }

    // Check if this is an organization-only setting
    if (settingConfig.organizationOnly) {
      throw new Error(`Setting ${key} is organization-only and cannot be overridden by users`)
    }

    // Validate the value type against the expected type
    this.validateSettingValue(value, settingConfig)

    // Get the organization setting to check if user override is allowed
    let [orgSetting] = await this.database
      .select()
      .from(schema.OrganizationSetting)
      .where(
        and(
          eq(schema.OrganizationSetting.organizationId, organizationId),
          eq(schema.OrganizationSetting.key, key)
        )
      )
      .limit(1)

    // Auto-create the organization setting if it doesn't exist
    if (!orgSetting) {
      logger.info(`Auto-creating organization setting: ${key}`)
      const [newOrgSetting] = await this.database
        .insert(schema.OrganizationSetting)
        .values({
          organizationId,
          key,
          value: settingConfig.defaultValue,
          allowUserOverride: true,
          scope: settingConfig.scope,
          updatedAt: new Date(),
        })
        .returning()
      orgSetting = newOrgSetting
    }

    if (!orgSetting.allowUserOverride) {
      throw new Error(`User override not allowed for setting ${key}`)
    }

    // Upsert the user setting
    await this.database
      .insert(schema.UserSetting)
      .values({
        userId,
        organizationSettingId: orgSetting.id,
        value: value,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [schema.UserSetting.userId, schema.UserSetting.organizationSettingId],
        set: { value: value, updatedAt: new Date() },
      })
  }

  /**
   * Reset a user setting to the organization default
   */
  async resetUserSetting(params: {
    userId: string
    organizationId: string
    key: string
  }): Promise<void> {
    const { userId, organizationId, key } = params

    // Get the organization setting
    const [orgSetting] = await this.database
      .select()
      .from(schema.OrganizationSetting)
      .where(
        and(
          eq(schema.OrganizationSetting.organizationId, organizationId),
          eq(schema.OrganizationSetting.key, key)
        )
      )
      .limit(1)

    if (!orgSetting) {
      return // Nothing to reset
    }

    // Delete the user setting if it exists
    await this.database
      .delete(schema.UserSetting)
      .where(
        and(
          eq(schema.UserSetting.userId, userId),
          eq(schema.UserSetting.organizationSettingId, orgSetting.id)
        )
      )
  }

  /**
   * Batch update organization settings
   */
  async batchUpdateOrganizationSettings(params: {
    organizationId: string
    settings: Array<{ key: string; value: SettingValue; allowUserOverride: boolean }>
  }): Promise<void> {
    const { organizationId, settings } = params

    // Use a transaction to ensure all updates succeed or fail together
    await this.database.transaction(async (tx) => {
      for (const setting of settings) {
        const { key, value, allowUserOverride } = setting

        // Check if the setting exists in the catalog
        const settingConfig = SETTINGS_CATALOG[key]
        if (!settingConfig) {
          throw new Error(`Unknown setting: ${key}`)
        }

        // If this is an organization-only setting, force allowUserOverride to false
        let effectiveAllowUserOverride = allowUserOverride
        if (settingConfig.organizationOnly && allowUserOverride) {
          logger.warn(`Setting ${key} is organization-only; ignoring allowUserOverride=true`)
          effectiveAllowUserOverride = false
        }

        // Validate the value type against the expected type
        this.validateSettingValue(value, settingConfig)

        // Upsert the organization setting
        await tx
          .insert(schema.OrganizationSetting)
          .values({
            organizationId,
            key,
            value: value,
            allowUserOverride: effectiveAllowUserOverride,
            scope: settingConfig.scope,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [schema.OrganizationSetting.organizationId, schema.OrganizationSetting.key],
            set: {
              value: value,
              allowUserOverride: effectiveAllowUserOverride,
              updatedAt: new Date(),
            },
          })
      }
    })
  }

  /**
   * Get all settings for an organization with their metadata
   */
  async getOrganizationSettingsWithMetadata(params: {
    organizationId: string
    scope?: string
  }): Promise<
    Array<{ key: string; value: SettingValue; allowUserOverride: boolean; metadata: SettingConfig }>
  > {
    const { organizationId, scope } = params

    // Get all organization settings
    const orgSettings = await this.database
      .select()
      .from(schema.OrganizationSetting)
      .where(
        and(
          eq(schema.OrganizationSetting.organizationId, organizationId),
          ...(scope ? [eq(schema.OrganizationSetting.scope, scope as any)] : [])
        )
      )

    // Build result with metadata
    const results = Object.entries(SETTINGS_CATALOG)
      .filter(([_, config]) => !scope || config.scope === scope)
      .map(([key, metadata]) => {
        const orgSetting = orgSettings.find((s) => s.key === key)

        return {
          key,
          value: orgSetting ? (orgSetting.value as SettingValue) : metadata.defaultValue,
          allowUserOverride: orgSetting ? orgSetting.allowUserOverride : !metadata.organizationOnly,
          metadata,
        }
      })

    return results
  }

  /**
   * Validate a setting value against its expected type
   */
  private validateSettingValue(value: SettingValue, config: SettingConfig): void {
    // For image type, allow empty string as valid (means no image set)
    if (config.type === 'image' && value === '' && config.defaultValue === '') {
      return
    }

    if (value === null && config.defaultValue === null) {
      return
    }

    switch (config.type) {
      case 'string':
      case 'font':
        if (typeof value !== 'string') {
          throw new Error(`Setting ${config.key} expects a string value`)
        }

        // If options are provided, validate against them
        if (config.options && !config.options.some((opt) => opt.value === value)) {
          throw new Error(
            `Setting ${config.key} expects one of: ${config.options.map((o) => o.value).join(', ')}`
          )
        }
        break

      case 'number':
        if (typeof value !== 'number') {
          throw new Error(`Setting ${config.key} expects a number value`)
        }

        // If options are provided, validate against them
        if (config.options && !config.options.some((opt) => opt.value === value)) {
          throw new Error(
            `Setting ${config.key} expects one of: ${config.options.map((o) => o.value).join(', ')}`
          )
        }
        break

      case 'boolean':
        if (typeof value !== 'boolean') {
          throw new Error(`Setting ${config.key} expects a boolean value`)
        }
        break

      case 'color':
        if (typeof value !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(value)) {
          throw new Error(`Setting ${config.key} expects a hex color value (e.g., #FF0000)`)
        }
        break

      case 'image':
        // For images, we expect a string URL or empty string (empty string means no image)
        if (typeof value !== 'string') {
          throw new Error(`Setting ${config.key} expects a string URL`)
        }
        break

      case 'object':
        if (value === null || typeof value !== 'object') {
          throw new Error(`Setting ${config.key} expects an object value`)
        }
        break

      default:
        throw new Error(`Unknown setting type: ${config.type}`)
    }
  }
}
