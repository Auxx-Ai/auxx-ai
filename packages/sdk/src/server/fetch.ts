// packages/sdk/src/server/fetch.ts

/**
 * Options for making an external API request
 */
export interface FetchOptions {
  /** HTTP method */
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  /** URL to fetch */
  url: string
  /** Request headers */
  headers?: Record<string, string>
  /** Request body (will be JSON stringified if object) */
  body?: any
  /** Timeout in milliseconds */
  timeout?: number
}

/**
 * Response from a fetch request
 */
export interface FetchResponse<T = any> {
  /** Response status code */
  status: number
  /** Response headers */
  headers: Record<string, string>
  /** Parsed response body */
  data: T
}

/**
 * Make an HTTP request to an external API.
 *
 * This function provides rate limiting, logging, and security checks
 * managed by the Auxx platform.
 *
 * @param options - Fetch options
 * @returns The API response
 *
 * @example
 * ```typescript
 * import { fetch } from '@auxx/sdk/server'
 *
 * const response = await fetch({
 *   method: 'GET',
 *   url: 'https://api.example.com/data',
 *   headers: { 'Authorization': 'Bearer token' }
 * })
 * ```
 */
export async function fetch<T = any>(
  options: FetchOptions
): Promise<FetchResponse<T>> {
  if (typeof (global as any).AUXX_SERVER_SDK !== 'undefined') {
    const sdk = (global as any).AUXX_SERVER_SDK
    if (typeof sdk.fetch === 'function') {
      return sdk.fetch(options)
    }
  }

  throw new Error(
    '[auxx/server] Server SDK not available. ' +
      'This code must run in the Auxx server environment.'
  )
}
