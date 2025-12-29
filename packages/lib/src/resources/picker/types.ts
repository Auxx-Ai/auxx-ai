// packages/lib/src/resources/picker/types.ts

/**
 * Input for paginated resource picker queries
 * Accepts both system TableId (e.g., 'contact') and custom entity IDs (e.g., 'entity_product')
 */
export interface GetResourcesInput {
  /** Resource ID - can be system TableId or custom entity ID (entity_xxx) */
  tableId: string

  /** Maximum items per page (1-100) */
  limit: number

  /** Cursor for pagination (composite: sortField|id) */
  cursor?: string | null

  /** Search query (matches displayNameField and searchFields) */
  search?: string

  /** Optional field-level filters (field key → value) */
  filters?: Record<string, unknown>

  /** Skip cache and fetch fresh data */
  skipCache?: boolean
}

/**
 * Resource item formatted for picker display
 */
export interface ResourcePickerItem {
  /** Resource ID */
  id: string

  /** Resource type - can be system TableId or custom entity ID (entity_xxx) */
  tableId: string

  /** Primary identifier (from identifierField) */
  identifier: string

  /** Display name (from displayNameField) */
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
  items: ResourcePickerItem[]
  nextCursor: string | null
  totalCount?: number
}

/**
 * Single resource query
 */
export interface GetResourceByIdInput {
  /** Resource ID - can be system TableId or custom entity ID (entity_xxx) */
  tableId: string
  id: string
}
