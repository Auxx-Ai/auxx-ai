// packages/sdk/src/server/connections.ts

/**
 * Connection object returned by getUserConnection/getOrganizationConnection
 */
export interface Connection {
  /** Unique connection ID */
  id: string

  /** Connection type (oauth2, api_key, secret) */
  type: 'oauth2-code' | 'secret'

  /**
   * The credential value (access token, API key, or secret)
   * Use this to authenticate with external services
   */
  value: string

  /** Additional metadata about the connection */
  metadata?: {
    /** OAuth scopes granted */
    scope?: string
    /** External service user ID */
    externalUserId?: string
    /** Token type (Bearer, etc.) */
    tokenType?: string
    /** Custom metadata defined by app */
    [key: string]: any
  }

  /** For OAuth2 connections, when the token expires */
  expiresAt?: Date
}

/**
 * Error thrown when connection is not found.
 * Platform catches this and prompts user to authenticate.
 */
export class ConnectionNotFoundError extends Error {
  code = 'CONNECTION_NOT_FOUND'

  constructor(public scope: 'user' | 'organization') {
    super(`${scope} connection not found. Please connect your account.`)
    this.name = 'ConnectionNotFoundError'
  }
}

/**
 * Get the current user's connection to an external service.
 *
 * Throws ConnectionNotFoundError if user is not connected.
 * Platform catches this error and prompts user to authenticate.
 *
 * @returns User's connection credentials
 *
 * @example
 * ```typescript
 * import { getUserConnection } from '@auxx/sdk/server'
 *
 * export default async function syncOrders() {
 *   // Get user's Shopify connection
 *   const connection = getUserConnection()
 *
 *   const response = await fetch('https://api.shopify.com/orders', {
 *     headers: {
 *       'Authorization': `Bearer ${connection.value}`
 *     }
 *   })
 *
 *   return await response.json()
 * }
 * ```
 */
export function getUserConnection(): Connection {
  // Runtime injection (similar to other SDK functions)
  if (typeof (global as any).AUXX_SERVER_SDK !== 'undefined') {
    const sdk = (global as any).AUXX_SERVER_SDK
    if (typeof sdk.getUserConnection === 'function') {
      return sdk.getUserConnection()
    }
  }

  throw new Error(
    '[auxx/server] Server SDK not available. ' +
      'This code must run in the Auxx server environment.'
  )
}

/**
 * Get the organization-wide connection to an external service.
 *
 * Throws ConnectionNotFoundError if organization is not connected.
 * Platform catches this error and prompts admin to authenticate.
 *
 * @returns Organization connection credentials
 *
 * @example
 * ```typescript
 * import { getOrganizationConnection } from '@auxx/sdk/server'
 *
 * export default async function fetchCompanyData() {
 *   // Get company's Stripe connection
 *   const connection = getOrganizationConnection()
 *
 *   const response = await fetch('https://api.stripe.com/v1/customers', {
 *     headers: {
 *       'Authorization': `Bearer ${connection.value}`
 *     }
 *   })
 *
 *   return await response.json()
 * }
 * ```
 */
export function getOrganizationConnection(): Connection {
  if (typeof (global as any).AUXX_SERVER_SDK !== 'undefined') {
    const sdk = (global as any).AUXX_SERVER_SDK
    if (typeof sdk.getOrganizationConnection === 'function') {
      return sdk.getOrganizationConnection()
    }
  }

  throw new Error(
    '[auxx/server] Server SDK not available. ' +
      'This code must run in the Auxx server environment.'
  )
}
