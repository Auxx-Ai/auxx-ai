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

// ═══════════════════════════════════════════════════════════════════════════
// CONDITION-BASED FILTER CONVERSION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Condition interface for the searchbar.
 * Mirrors the condition type from @auxx/lib/conditions/types.
 */
export interface SearchCondition {
  id: string
  fieldId: string
  operator: string
  value: any
}

/**
 * Convert Condition[] to ApiSearchFilter format.
 * Used by useSearchFiltersForQuery hook.
 */
export function conditionsToApiFilter(conditions: SearchCondition[]): ApiSearchFilter | undefined {
  if (conditions.length === 0) return undefined

  const result: ApiSearchFilter = {}

  for (const condition of conditions) {
    switch (condition.fieldId) {
      case 'tag':
        result.tagIds = result.tagIds || []
        if (Array.isArray(condition.value)) {
          result.tagIds.push(...condition.value)
        } else if (condition.value) {
          result.tagIds.push(condition.value)
        }
        break

      case 'assignee':
        result.assigneeIds = result.assigneeIds || []
        if (Array.isArray(condition.value)) {
          result.assigneeIds.push(...condition.value)
        } else if (condition.value) {
          result.assigneeIds.push(condition.value)
        }
        break

      case 'inbox':
        result.inboxIds = result.inboxIds || []
        if (Array.isArray(condition.value)) {
          result.inboxIds.push(...condition.value)
        } else if (condition.value) {
          result.inboxIds.push(condition.value)
        }
        break

      case 'from':
      case 'sender':
        result.from = result.from || []
        if (condition.value) {
          result.from.push(condition.value)
        }
        break

      case 'to':
        result.to = result.to || []
        if (condition.value) {
          result.to.push(condition.value)
        }
        break

      case 'subject':
        result.subject = condition.value
        break

      case 'body':
        result.body = condition.value
        break

      case 'status':
        result.is = result.is || []
        if (condition.value) {
          // Handle both array and string values
          if (Array.isArray(condition.value)) {
            result.is.push(...condition.value)
          } else {
            result.is.push(condition.value)
          }
        }
        break

      case 'before':
        result.before = condition.value instanceof Date
          ? condition.value.toISOString()
          : condition.value
        break

      case 'after':
        result.after = condition.value instanceof Date
          ? condition.value.toISOString()
          : condition.value
        break

      case 'hasAttachments':
        result.hasAttachments = condition.value === true || condition.value === 'true'
        break

      case 'freeText':
        result.search = condition.value
        break
    }
  }

  return result
}

/**
 * Check if conditions array has any active values.
 */
export function hasActiveConditions(conditions: SearchCondition[]): boolean {
  return conditions.length > 0 && conditions.some(c => c.value !== undefined && c.value !== '')
}
