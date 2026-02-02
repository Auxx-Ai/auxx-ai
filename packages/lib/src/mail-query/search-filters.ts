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
 * Condition interface for the searchbar.
 * Mirrors the condition type from @auxx/lib/conditions/types.
 */
export interface SearchCondition {
  id: string
  fieldId: string
  operator: string
  value: any
}
