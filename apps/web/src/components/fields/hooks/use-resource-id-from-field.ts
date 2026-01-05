// apps/web/src/components/fields/hooks/use-resource-id-from-field.ts

import { useMemo } from 'react'

/**
 * Relationship options from a field definition
 */
interface RelationshipOptions {
  relatedEntityDefinitionId?: string
  relatedModelType?: string
}

/**
 * Field structure with optional relationship options
 */
interface FieldWithRelationship {
  options?: {
    relationship?: RelationshipOptions
  }
}

/**
 * Result from useResourceIdFromField hook.
 * Contains tableId (system resource ID or custom entity UUID).
 */
export interface ResourceIdResult {
  /** System resource ID (e.g., "contact", "ticket") or custom entity UUID */
  tableId: string
  /** Custom entity UUID (for custom entities only, same as tableId) */
  entityDefinitionId?: string
}

/**
 * Hook to extract resource identification from a relationship field.
 * Returns tableId which is either a system resource ID or custom entity UUID.
 *
 * The stored value in relatedEntityDefinitionId is:
 * - System resource ID (contact, ticket, etc.) - used directly as tableId
 * - UUID (EntityDefinition.id) - used directly as tableId (no entity_ prefix)
 *
 * @param field - Field definition with relationship options
 * @returns ResourceIdResult or null if not a valid relationship field
 */
export function useResourceIdFromField(field: FieldWithRelationship): ResourceIdResult | null {
  return useMemo(() => {
    const relationship = field.options?.relationship
    if (!relationship) return null

    // System resource (contact, ticket, etc.) - use relatedModelType as tableId
    if (relationship.relatedModelType) {
      return { tableId: relationship.relatedModelType }
    }

    // Custom entity - use relatedEntityDefinitionId (UUID directly, no prefix)
    if (relationship.relatedEntityDefinitionId) {
      const uuid = relationship.relatedEntityDefinitionId
      return { tableId: uuid, entityDefinitionId: uuid }
    }

    return null
  }, [field.options?.relationship])
}
