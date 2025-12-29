// packages/lib/src/workflow-engine/nodes/types/list-types.ts

/**
 * Sort direction for list operations
 */
export type SortDirection = 'asc' | 'desc'

/**
 * Null handling options for sorting
 */
export type NullHandling = 'first' | 'last'

/**
 * Sort configuration for list node
 * Simplified single-field sort (replaces previous array-based multi-sort)
 */
export interface SortConfig {
  /** Field to sort by (supports nested paths like "contact.name") */
  field: string
  /** Sort direction */
  direction: SortDirection
  /** How to handle null values (default: 'last') */
  nullHandling?: NullHandling
}

/**
 * Available list operations
 */
export type ListOperation =
  | 'filter'
  | 'sort'
  | 'map'
  | 'reduce'
  | 'slice'
  | 'unique'
  | 'group'
  | 'find'
  | 'join'
  | 'pluck'
  | 'flatten'
  | 'reverse'
