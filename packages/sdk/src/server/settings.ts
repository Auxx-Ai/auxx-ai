// packages/sdk/src/server/settings.ts

/**
 * Get a single organization setting value
 * Returns: saved value OR default from schema OR undefined
 *
 * @param key - The setting key to retrieve
 * @returns The setting value or undefined if not found
 *
 * @example
 * ```typescript
 * import { getOrganizationSetting } from '@auxx/sdk/server'
 *
 * export default async function handler() {
 *   const apiKey = await getOrganizationSetting('apiKey')
 *   const maxRetries = await getOrganizationSetting('maxRetries')
 *
 *   console.log('API Key:', apiKey)
 *   console.log('Max Retries:', maxRetries)
 * }
 * ```
 */
export async function getOrganizationSetting<T = any>(key: string): Promise<T | undefined> {
  // Runtime injection (similar to other SDK functions)
  if (typeof (global as any).AUXX_SERVER_SDK !== 'undefined') {
    const sdk = (global as any).AUXX_SERVER_SDK
    if (typeof sdk.getOrganizationSetting === 'function') {
      return sdk.getOrganizationSetting(key)
    }
  }

  throw new Error(
    '[auxx/server] Server SDK not available. ' +
      'This code must run in the Auxx server environment.'
  )
}

/**
 * Get all organization settings, merged with defaults
 *
 * @returns Object with all organization settings
 *
 * @example
 * ```typescript
 * import { getOrganizationSettings } from '@auxx/sdk/server'
 *
 * export default async function handler() {
 *   const settings = await getOrganizationSettings()
 *
 *   console.log('All settings:', settings)
 * }
 * ```
 */
export async function getOrganizationSettings<T = Record<string, any>>(): Promise<T> {
  if (typeof (global as any).AUXX_SERVER_SDK !== 'undefined') {
    const sdk = (global as any).AUXX_SERVER_SDK
    if (typeof sdk.getOrganizationSettings === 'function') {
      return sdk.getOrganizationSettings()
    }
  }

  throw new Error(
    '[auxx/server] Server SDK not available. ' +
      'This code must run in the Auxx server environment.'
  )
}

/**
 * Set a single organization setting value
 *
 * @param key - The setting key to update
 * @param value - The new value
 *
 * @example
 * ```typescript
 * import { setOrganizationSetting } from '@auxx/sdk/server'
 *
 * export default async function handler() {
 *   await setOrganizationSetting('enableDebugMode', true)
 *   await setOrganizationSetting('maxRetries', 5)
 * }
 * ```
 */
export async function setOrganizationSetting<T = any>(key: string, value: T): Promise<void> {
  if (typeof (global as any).AUXX_SERVER_SDK !== 'undefined') {
    const sdk = (global as any).AUXX_SERVER_SDK
    if (typeof sdk.setOrganizationSetting === 'function') {
      return sdk.setOrganizationSetting(key, value)
    }
  }

  throw new Error(
    '[auxx/server] Server SDK not available. ' +
      'This code must run in the Auxx server environment.'
  )
}

/**
 * Set multiple organization settings at once
 *
 * @param settings - Object with settings to update
 *
 * @example
 * ```typescript
 * import { setOrganizationSettings } from '@auxx/sdk/server'
 *
 * export default async function handler() {
 *   await setOrganizationSettings({
 *     apiKey: 'new-key',
 *     maxRetries: 5,
 *     enableDebugMode: true
 *   })
 * }
 * ```
 */
export async function setOrganizationSettings(settings: Record<string, any>): Promise<void> {
  if (typeof (global as any).AUXX_SERVER_SDK !== 'undefined') {
    const sdk = (global as any).AUXX_SERVER_SDK
    if (typeof sdk.setOrganizationSettings === 'function') {
      return sdk.setOrganizationSettings(settings)
    }
  }

  throw new Error(
    '[auxx/server] Server SDK not available. ' +
      'This code must run in the Auxx server environment.'
  )
}
