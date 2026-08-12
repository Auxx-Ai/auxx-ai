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
 * Available list operations.
 *
 * Mirrors the builder's `ListOperation`
 * (`apps/web/src/components/workflow/nodes/core/list/types.ts`) exactly — the
 * `ListProcessor` throws `Unknown operation` on anything else, so a value here
 * that the switch does not handle is a promise the node cannot keep.
 */
export type ListOperation = 'filter' | 'sort' | 'slice' | 'unique' | 'join' | 'pluck' | 'reverse'
