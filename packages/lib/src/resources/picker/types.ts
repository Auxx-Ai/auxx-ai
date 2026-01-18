// packages/lib/src/resources/picker/types.ts

import type { RecordId } from '@auxx/types/resource'

/**
 * Input for paginated resource picker queries
 * Accepts both system TableId (e.g., 'contact') and custom entity UUIDs
 */
export interface GetResourcesInput {
  /** Entity definition ID - system resource ID (contact, ticket) or custom entity UUID */
  entityDefinitionId: string

  /** Maximum items per page (1-100) */
  limit: number

  /** Cursor for pagination (composite: sortField|id) */
  cursor?: string | null

  /** Search query (matches primaryDisplayField and searchFields) */
  search?: string

  /** Optional field-level filters (field key → value) */
  filters?: Record<string, unknown>

  /** Skip cache and fetch fresh data */
  skipCache?: boolean
}

/**
 * Record item formatted for picker display
 */
export interface RecordPickerItem {
  /** Instance ID (just the entity instance ID, not the full RecordId) */
  id: string

  /** Full RecordId in format "entityDefinitionId:entityInstanceId" */
  recordId: RecordId

  /** Display name (from primaryDisplayField) */
  displayName: string

  /** Optional secondary info (subtitle in picker) */
  secondaryInfo?: string

  /** Optional avatar URL */
  avatarUrl?: string

  /** Full row data (for custom rendering) */
  data: Record<string, unknown>

  /** Timestamps (can be Date or ISO string) */
  createdAt: Date | string
  updatedAt: Date | string
}

/**
 * Paginated picker results
 */
export interface PaginatedResourcesResult {
  items: RecordPickerItem[]
  nextCursor: string | null
  totalCount?: number
}

/**
 * Single resource query
 */
export interface GetResourceByIdInput {
  /** Entity definition ID - system resource ID (contact, ticket) or custom entity UUID */
  entityDefinitionId: string
  id: string
}

/**
 * Parameters for global entity search
 */
export interface GlobalSearchParams {
  /** Search query string (optional - if empty, returns first N records) */
  query?: string

  /** Optional - if provided, searches only that entity type */
  entityDefinitionId?: string

  /** Optional - filter to multiple entity types (only used in global search mode) */
  entityDefinitionIds?: string[]

  /** Max results per page (default 25, max 100) */
  limit?: number

  /** Cursor for pagination (encoded score|id) */
  cursor?: string
}

/**
 * Global search result with metadata
 */
export interface GlobalSearchResult extends PaginatedResourcesResult {
  /** Whether there are more results */
  hasMore: boolean

  /** Query processing time in milliseconds */
  processingTimeMs: number

  /** The search query that was executed */
  query: string
}
