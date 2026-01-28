// packages/lib/src/mail-query/search-filters.ts

/**
 * Reference to a database entity with display info.
 * Stores both the ID (for API) and name (for display).
 */
export interface FilterRef {
  id: string
  name: string
}

/**
 * Structured search filters for mail queries.
 * Entity references store both ID (for API) and name (for display).
 * This is the client-side representation used in the Zustand store.
 */
export interface SearchFilters {
  /** Free text search across multiple fields */
  freeText?: string

  /** Email participant filters */
  from?: string[]
  to?: string[]

  /** Entity references with ID + display name */
  tags?: FilterRef[]
  assignees?: FilterRef[]
  inboxes?: FilterRef[]

  /** Text field filters */
  subject?: string
  body?: string

  /** Status filters: read, unread, starred, snoozed, archived */
  is?: string[]

  /** Property filters */
  hasAttachments?: boolean

  /** Date filters */
  before?: Date
  after?: Date
}

/**
 * API filter format expected by tRPC endpoints.
 * Contains only IDs, not display names.
 * Each filter field is handled separately by the query builder.
 */
export interface ApiSearchFilter {
  /** Free text search (searches across subject + body + other text fields) */
  search?: string

  /** Participant filters (email addresses) */
  from?: string[]
  to?: string[]

  /** Entity ID filters */
  tagIds?: string[]
  assigneeIds?: string[]
  inboxIds?: string[]

  /** Text field filters (separate from free text search) */
  subject?: string
  body?: string

  /** Status filters (read, unread, starred, snoozed, archived, etc.) */
  is?: string[]

  /** Property filters */
  hasAttachments?: boolean

  /** Date filters (ISO string format) */
  before?: string
  after?: string
}

/**
 * Check if filters have any active values.
 */
export function hasActiveFilters(filters: SearchFilters): boolean {
  return !!(
    filters.freeText ||
    filters.from?.length ||
    filters.to?.length ||
    filters.tags?.length ||
    filters.assignees?.length ||
    filters.inboxes?.length ||
    filters.subject ||
    filters.body ||
    filters.is?.length ||
    filters.hasAttachments ||
    filters.before ||
    filters.after
  )
}

/**
 * Convert SearchFilters (with display names) to ApiSearchFilter (IDs only).
 * This is used to transform the client-side store state to the format
 * expected by the tRPC API.
 */
export function filtersToApiFilter(
  filters: SearchFilters
): ApiSearchFilter | undefined {
  if (!hasActiveFilters(filters)) return undefined

  const result: ApiSearchFilter = {}

  if (filters.freeText) result.search = filters.freeText
  if (filters.from?.length) result.from = filters.from
  if (filters.to?.length) result.to = filters.to
  if (filters.tags?.length) result.tagIds = filters.tags.map((t) => t.id)
  if (filters.assignees?.length)
    result.assigneeIds = filters.assignees.map((a) => a.id)
  if (filters.inboxes?.length)
    result.inboxIds = filters.inboxes.map((i) => i.id)
  if (filters.subject) result.subject = filters.subject
  if (filters.body) result.body = filters.body
  if (filters.is?.length) result.is = filters.is
  if (filters.hasAttachments !== undefined)
    result.hasAttachments = filters.hasAttachments
  if (filters.before) result.before = filters.before.toISOString()
  if (filters.after) result.after = filters.after.toISOString()

  return result
}
