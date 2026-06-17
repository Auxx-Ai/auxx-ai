// packages/sdk/src/client/hooks/index.ts

/**
 * React hooks for accessing Auxx platform data and functionality
 */

import { Host } from '../../runtime/host.js'
import { useAsyncCache } from './use-async-cache.js'

// Export async cache hook
export { type AsyncCacheConfig, type AsyncFunction, useAsyncCache } from './use-async-cache.js'

/**
 * Record data structure returned by {@link useRecord}.
 *
 * `data` is keyed by each field's stable attribute key (e.g. `primary_email`,
 * `phone`) and carries plain values — a scalar for single-value fields, an
 * array for multi-value fields.
 */
export interface AuxxRecord {
  id: string
  type: string
  displayName?: string
  data: Record<string, any>
  createdAt?: string | Date
  updatedAt?: string | Date
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

/** Fetch a record from the host platform (resolved by the record data-handler). */
function fetchRecordFromHost(recordId: string): Promise<AuxxRecord> {
  return Host.sendRequest<AuxxRecord>('get-record', { recordId })
}

/**
 * Hook to access a single record by ID, with its field values.
 *
 * Backed by {@link useAsyncCache}, so it **suspends** until the record loads —
 * render it under a `<Suspense>` boundary. Results are cached per `recordId`.
 *
 * @param recordId - The full record id (`<entityDefinitionId>:<entityInstanceId>`)
 * @returns The record, with field values keyed under `data` by each field's
 *   stable attribute key (e.g. the contact email is `data.primary_email`, not
 *   `data.email`).
 *
 * @example
 * ```typescript
 * import { useRecord } from '@auxx/sdk/client'
 *
 * function ContactEmail({ recordId }: { recordId: string }) {
 *   const record = useRecord(recordId)
 *   return <TextBlock>{record.data.primary_email}</TextBlock>
 * }
 * ```
 */
export function useRecord(recordId: string): AuxxRecord {
  const {
    values: { record },
  } = useAsyncCache({ record: [fetchRecordFromHost, recordId] })
  return record
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
