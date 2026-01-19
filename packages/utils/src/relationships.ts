// packages/utils/src/relationships.ts

import type { RelationshipType } from '@auxx/types/custom-field'

// Re-export RelationshipType for consumers that import from @auxx/utils
export type { RelationshipType }

/**
 * Get the inverse cardinality for a relationship type.
 * Used when creating bidirectional relationships or syncing inverse caches.
 *
 * - belongs_to → has_many (the "one" side typically has many)
 * - has_one → has_one (symmetric one-to-one)
 * - has_many → belongs_to (each item belongs to source)
 * - many_to_many → many_to_many (symmetric)
 */
export function getInverseCardinality(type: RelationshipType): RelationshipType {
  switch (type) {
    case 'belongs_to':
      return 'has_many'
    case 'has_one':
      return 'has_one'
    case 'has_many':
      return 'belongs_to'
    case 'many_to_many':
      return 'many_to_many'
  }
}

/**
 * Check if a relationship type allows multiple values (has_many, many_to_many).
 *
 * @param relationshipType - The relationship cardinality type
 * @returns true if has_many or many_to_many, false for belongs_to/has_one/undefined
 */
export function isMultiRelationship(relationshipType?: RelationshipType | string): boolean {
  return relationshipType === 'has_many' || relationshipType === 'many_to_many'
}

/**
 * Check if a relationship type stores a single value (belongs_to, has_one).
 *
 * @param relationshipType - The relationship cardinality type
 * @returns true if belongs_to or has_one, false for has_many/many_to_many/undefined
 */
export function isSingleRelationship(relationshipType?: RelationshipType | string): boolean {
  return relationshipType === 'belongs_to' || relationshipType === 'has_one'
}

