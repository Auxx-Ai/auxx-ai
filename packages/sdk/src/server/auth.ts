// packages/sdk/src/server/auth.ts

/**
 * User information
 */
export interface User {
  /** User ID */
  id: string
  /** User email */
  email: string
  /** User display name */
  name: string
  /** User avatar URL */
  avatar?: string
  /** User role */
  role?: string
}

/**
 * Get the current authenticated user.
 *
 * @returns The current user
 *
 * @example
 * ```typescript
 * import { getCurrentUser } from '@auxx/sdk/server'
 *
 * const user = await getCurrentUser()
 * console.log(`Request from: ${user.email}`)
 * ```
 */
export async function getCurrentUser(): Promise<User> {
  if (typeof (global as any).AUXX_SERVER_SDK !== 'undefined') {
    const sdk = (global as any).AUXX_SERVER_SDK
    if (typeof sdk.getCurrentUser === 'function') {
      return sdk.getCurrentUser()
    }
  }

  throw new Error(
    '[auxx/server] Server SDK not available. ' +
      'This code must run in the Auxx server environment.'
  )
}

/**
 * Get an API token for making authenticated requests.
 *
 * @returns API token string
 *
 * @example
 * ```typescript
 * import { getApiToken } from '@auxx/sdk/server'
 *
 * const token = await getApiToken()
 * // Use token for API requests
 * ```
 */
export async function getApiToken(): Promise<string> {
  if (typeof (global as any).AUXX_SERVER_SDK !== 'undefined') {
    const sdk = (global as any).AUXX_SERVER_SDK
    if (typeof sdk.getApiToken === 'function') {
      return sdk.getApiToken()
    }
  }

  throw new Error(
    '[auxx/server] Server SDK not available. ' +
      'This code must run in the Auxx server environment.'
  )
}
