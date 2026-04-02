// apps/web/src/components/searchbar/types.ts

import type { Operator } from '@auxx/lib/conditions/client'

/**
 * Search condition - the core data type for search stores.
 * Uses Condition[] as the single source of truth.
 */
export interface SearchCondition {
  id: string
  fieldId: string
  operator: Operator
  value: any
  /** Display label for entity references (tags, assignees, inboxes) */
  displayLabel?: string
}

/**
 * Editing condition reference with index
 */
export interface EditingCondition {
  id: string
  index: number
}

/**
 * Suggestion types for search suggestions
 * - 'field': A field definition to add as a condition
 * - 'recent': A recent search that restores a full set of conditions
 */
export type SearchSuggestionType = 'field' | 'recent'

/**
 * Generic field definition for suggestions.
 * Consumers provide their own field definition type that extends this.
 */
export interface SearchFieldDefinition {
  id: string
  label: string
  type: string
  description?: string
}

/**
 * Search suggestion interface
 */
export interface SearchSuggestion {
  type: SearchSuggestionType

  /** For 'field' type: the field ID */
  fieldId?: string

  /** For 'field' type: field definition for display */
  fieldDefinition?: SearchFieldDefinition

  /** For 'recent' type: stored conditions to restore */
  conditions?: SearchCondition[]

  /** Common display props */
  value: string
  label: string
  description?: string
}
