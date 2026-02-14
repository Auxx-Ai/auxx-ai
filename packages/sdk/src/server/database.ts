// packages/sdk/src/server/database.ts

/**
 * Options for executing a database query
 */
export interface QueryOptions {
  /** SQL query string */
  sql: string
  /** Query parameters for parameterized queries */
  params?: any[]
}

/**
 * Execute a SQL query against the Auxx database.
 *
 * @param options - Query options
 * @returns Array of query results
 *
 * @example
 * ```typescript
 * import { query } from '@auxx/sdk/server'
 *
 * const users = await query({
 *   sql: 'SELECT * FROM users WHERE id = ?',
 *   params: [userId]
 * })
 * ```
 */
export async function query<T = any>(options: QueryOptions): Promise<T[]> {
  // Server runtime injection
  if (typeof (global as any).AUXX_SERVER_SDK !== 'undefined') {
    const sdk = (global as any).AUXX_SERVER_SDK
    if (typeof sdk.query === 'function') {
      return sdk.query(options)
    }
  }

  throw new Error(
    '[auxx/server] Server SDK not available. ' +
      'This code must run in the Auxx server environment.'
  )
}

/**
 * Execute a SQL query and return a single result.
 *
 * @param options - Query options
 * @returns Single query result or null if no results
 *
 * @example
 * ```typescript
 * import { queryOne } from '@auxx/sdk/server'
 *
 * const user = await queryOne({
 *   sql: 'SELECT * FROM users WHERE email = ?',
 *   params: ['user@example.com']
 * })
 * ```
 */
export async function queryOne<T = any>(options: QueryOptions): Promise<T | null> {
  const results = await query<T>(options)
  return results[0] ?? null
}
