// packages/sdk/src/client/hooks/index.ts

/**
 * React hooks for accessing Auxx platform data and functionality
 */

// Export async cache hook
export { useAsyncCache, type AsyncFunction, type AsyncCacheConfig } from './use-async-cache.js'

/**
 * Record data structure
 */
export interface AuxxRecord {
  id: string
  type: string
  data: Record<string, any>
  createdAt: Date
  updatedAt: Date
}

/**
 * Query for filtering records
 */
export interface Query {
  type: string
  filters?: Record<string, any>
  limit?: number
  offset?: number
}

/**
 * User data structure
 */
export interface User {
  id: string
  email: string
  name: string
  avatar?: string
}

/**
 * App settings data structure
 */
export interface AppSettings {
  [key: string]: any
}

/**
 * Hook to access a single record by ID
 *
 * @param _recordId - The ID of the record to fetch
 * @returns The record data
 *
 * @example
 * ```typescript
 * import { useRecord } from '@auxx/sdk/client'
 *
 * function MyComponent() {
 *   const record = useRecord('rec_123')
 *   return <div>{record.data.title}</div>
 * }
 * ```
 */
export function useRecord(_recordId: string): AuxxRecord {
  throw new Error('[auxx/client] useRecord hook not available - must be provided by runtime')
}

/**
 * Hook to query multiple records
 *
 * @param _query - The query parameters
 * @returns Array of matching records
 *
 * @example
 * ```typescript
 * import { useRecords } from '@auxx/sdk/client'
 *
 * function MyComponent() {
 *   const tickets = useRecords({ type: 'ticket', filters: { status: 'open' } })
 *   return <div>{tickets.length} open tickets</div>
 * }
 * ```
 */
export function useRecords(_query: Query): AuxxRecord[] {
  throw new Error('[auxx/client] useRecords hook not available - must be provided by runtime')
}

/**
 * Hook to access the current user
 *
 * @returns The current user data
 *
 * @example
 * ```typescript
 * import { useCurrentUser } from '@auxx/sdk/client'
 *
 * function MyComponent() {
 *   const user = useCurrentUser()
 *   return <div>Hello, {user.name}!</div>
 * }
 * ```
 */
export function useCurrentUser(): User {
  throw new Error('[auxx/client] useCurrentUser hook not available - must be provided by runtime')
}

/**
 * Hook to access app settings
 *
 * @returns The app settings
 *
 * @example
 * ```typescript
 * import { useSettings } from '@auxx/sdk/client'
 *
 * function MyComponent() {
 *   const settings = useSettings()
 *   return <div>API Key: {settings.apiKey}</div>
 * }
 * ```
 */
export function useSettings(): AppSettings {
  throw new Error('[auxx/client] useSettings hook not available - must be provided by runtime')
}
