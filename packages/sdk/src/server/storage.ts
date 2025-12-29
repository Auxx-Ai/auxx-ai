// packages/sdk/src/server/storage.ts

/**
 * Get a value from extension storage.
 *
 * Storage is scoped to the current app/extension.
 *
 * @param key - Storage key
 * @returns The stored value or null if not found
 *
 * @example
 * ```typescript
 * import { get } from '@auxx/sdk/server'
 *
 * const apiKey = await get('api_key')
 * if (apiKey) {
 *   // Use the API key
 * }
 * ```
 */
export async function get(key: string): Promise<string | null> {
  if (typeof (global as any).AUXX_SERVER_SDK !== 'undefined') {
    const sdk = (global as any).AUXX_SERVER_SDK
    if (sdk.storage && typeof sdk.storage.get === 'function') {
      return sdk.storage.get(key)
    }
  }

  throw new Error(
    '[auxx/server] Server SDK not available. ' +
      'This code must run in the Auxx server environment.'
  )
}

/**
 * Set a value in extension storage.
 *
 * Storage is scoped to the current app/extension.
 *
 * @param key - Storage key
 * @param value - Value to store
 *
 * @example
 * ```typescript
 * import { set } from '@auxx/sdk/server'
 *
 * await set('api_key', 'sk_test_123456')
 * ```
 */
export async function set(key: string, value: string): Promise<void> {
  if (typeof (global as any).AUXX_SERVER_SDK !== 'undefined') {
    const sdk = (global as any).AUXX_SERVER_SDK
    if (sdk.storage && typeof sdk.storage.set === 'function') {
      return sdk.storage.set(key, value)
    }
  }

  throw new Error(
    '[auxx/server] Server SDK not available. ' +
      'This code must run in the Auxx server environment.'
  )
}

/**
 * Delete a value from extension storage.
 *
 * @param key - Storage key
 *
 * @example
 * ```typescript
 * import { remove } from '@auxx/sdk/server'
 *
 * await remove('api_key')
 * ```
 */
export async function remove(key: string): Promise<void> {
  if (typeof (global as any).AUXX_SERVER_SDK !== 'undefined') {
    const sdk = (global as any).AUXX_SERVER_SDK
    if (sdk.storage && typeof sdk.storage.delete === 'function') {
      return sdk.storage.delete(key)
    }
  }

  throw new Error(
    '[auxx/server] Server SDK not available. ' +
      'This code must run in the Auxx server environment.'
  )
}
