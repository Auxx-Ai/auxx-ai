import { database as db, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { DEFAULT_USER_SETTINGS, type UserSettings, type UserSettingsPath } from './types'

export * from './settings-initializer'
export * from './settings-service'
export * from './types'

export function getNestedValue<T>(obj: T, path: string): any {
  return path.split('.').reduce((prev, curr) => {
    return prev && typeof prev === 'object' ? prev[curr] : undefined
  }, obj as any)
}

export class UserSettingsService {
  /**
   * Get a user's settings, applying defaults for any missing settings
   */
  static async get<K extends UserSettingsPath | undefined>(
    userId: string,
    key?: K
  ): Promise<K extends UserSettingsPath ? any : UserSettings> {
    const [user] = await db
      .select({ settings: schema.User.settings })
      .from(schema.User)
      .where(eq(schema.User.id, userId))
      .limit(1)

    if (!user) throw new Error(`User with ID ${userId} not found`)

    // Merge user's stored settings with defaults to ensure all fields exist
    const settings = { ...DEFAULT_USER_SETTINGS, ...(user.settings as UserSettings) }
    if (!key) {
      return settings
    }

    return getNestedValue(settings, key) // The conditional return type handles the type safety
  }

  /**
   * Update specific settings for a user
   */
  static async update(userId: string, newSettings: Partial<UserSettings>): Promise<UserSettings> {
    // First get current settings
    const currentSettings = await UserSettingsService.get(userId)

    // Deep merge current settings with new settings
    const updatedSettings = UserSettingsService.deepMerge(currentSettings, newSettings)

    // Save to database
    const [user] = await db
      .update(schema.User)
      .set({ settings: updatedSettings })
      .where(eq(schema.User.id, userId))
      .returning({ settings: schema.User.settings })

    return user.settings as UserSettings
  }

  /**
   * Reset user settings to defaults
   */
  static async reset(userId: string): Promise<UserSettings> {
    const [user] = await db
      .update(schema.User)
      .set({ settings: DEFAULT_USER_SETTINGS })
      .where(eq(schema.User.id, userId))
      .returning({ settings: schema.User.settings })

    return user.settings as UserSettings
  }

  /**
   * Update a specific setting path (dot notation supported)
   * Example: updateOne(userId, 'notifications.email', false)
   */
  static async set(userId: string, path: string, value: any): Promise<UserSettings> {
    const currentSettings = await UserSettingsService.get(userId)

    // Split the path into parts
    const pathParts = path.split('.')

    // Create a nested object with the value at the specified path
    const newSettings = pathParts.reduceRight((acc, key, index) => {
      return { [key]: acc }
    }, value)

    // Merge with current settings
    const mergedSettings = UserSettingsService.deepMerge(currentSettings, newSettings)

    // Update settings in database
    return UserSettingsService.update(userId, mergedSettings)
  }

  /**
   * Deep merge utility for merging settings objects
   */
  private static deepMerge(target: any, source: any): any {
    const output = { ...target }

    if (UserSettingsService.isObject(target) && UserSettingsService.isObject(source)) {
      Object.keys(source).forEach((key) => {
        if (UserSettingsService.isObject(source[key])) {
          if (!(key in target)) {
            Object.assign(output, { [key]: source[key] })
          } else {
            output[key] = UserSettingsService.deepMerge(target[key], source[key])
          }
        } else {
          Object.assign(output, { [key]: source[key] })
        }
      })
    }

    return output
  }

  private static isObject(item: any): boolean {
    return item && typeof item === 'object' && !Array.isArray(item)
  }
}
