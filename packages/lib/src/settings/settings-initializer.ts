// lib/settings/settings-initializer.ts
import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import { SETTINGS_CATALOG, SettingsService } from './settings-service'

const logger = createScopedLogger('settings-initializer')

export class SettingsInitializer {
  private db: Database
  private settingsService: SettingsService

  constructor(db: Database) {
    this.db = db
    this.settingsService = new SettingsService(db)
  }

  /**
   * Initialize settings for a new organization
   * This should be called when a new organization is created
   * @param organizationId The organization ID
   */
  async initializeOrganizationSettings(organizationId: string): Promise<void> {
    logger.info('Initializing settings for new organization', { organizationId })

    try {
      // Create all settings from the catalog with default values
      const settingsToCreate = Object.entries(SETTINGS_CATALOG).map(([key, config]) => ({
        key,
        value: config.defaultValue,
        // For organization-only settings, user override is never allowed
        allowUserOverride: !config.organizationOnly,
      }))

      await this.settingsService.batchUpdateOrganizationSettings({
        organizationId,
        settings: settingsToCreate,
      })

      logger.info('Successfully initialized organization settings', {
        organizationId,
        settingCount: settingsToCreate.length,
      })
    } catch (error) {
      logger.error('Failed to initialize organization settings', { organizationId, error })
      throw error
    }
  }

  /**
   * Update all existing organizations with new settings from the catalog
   * This should be called when new settings are added to the catalog
   */
  async updateAllOrganizationsWithNewSettings(): Promise<void> {
    logger.info('Updating all organizations with new settings')

    try {
      // Get all organizations
      const organizations = await this.db
        .select({ id: schema.Organization.id })
        .from(schema.Organization)

      logger.info('Found organizations to update', { organizationCount: organizations.length })

      // For each organization, check and add any missing settings
      for (const organization of organizations) {
        await this.updateOrganizationWithNewSettings(organization.id)
      }

      logger.info('Successfully updated all organizations with new settings')
    } catch (error) {
      logger.error('Failed to update organizations with new settings', { error })
      throw error
    }
  }

  /**
   * Update a single organization with new settings from the catalog
   * @param organizationId The organization ID
   */
  async updateOrganizationWithNewSettings(organizationId: string): Promise<void> {
    logger.info('Updating organization with new settings', { organizationId })

    try {
      // Get all existing settings for this organization
      const existingSettings = await this.db
        .select({ key: schema.OrganizationSetting.key })
        .from(schema.OrganizationSetting)
        .where(eq(schema.OrganizationSetting.organizationId, organizationId))

      const existingKeys = new Set(existingSettings.map((s) => s.key))

      // Find settings in the catalog that don't exist for this organization
      const newSettings = Object.entries(SETTINGS_CATALOG)
        .filter(([key]) => !existingKeys.has(key))
        .map(([key, config]) => ({
          key,
          value: config.defaultValue,
          allowUserOverride: !config.organizationOnly,
        }))

      if (newSettings.length === 0) {
        logger.info('No new settings to add for organization', { organizationId })
        return
      }

      logger.info('Adding new settings to organization', {
        organizationId,
        newSettingCount: newSettings.length,
        newSettingKeys: newSettings.map((s) => s.key),
      })

      // Add the new settings
      await this.settingsService.batchUpdateOrganizationSettings({
        organizationId,
        settings: newSettings,
      })

      logger.info('Successfully updated organization with new settings', {
        organizationId,
        addedSettingCount: newSettings.length,
      })
    } catch (error) {
      logger.error('Failed to update organization with new settings', { organizationId, error })
      throw error
    }
  }
}
