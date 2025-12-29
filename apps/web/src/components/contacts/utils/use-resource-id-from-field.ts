// apps/web/src/components/contacts/utils/use-resource-id-from-field.ts

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
 * Hook to extract the canonical resourceId from a relationship field.
 * Returns the resourceId directly since it's already in the correct format.
 *
 * @param field - Field definition with relationship options
 * @returns resourceId string or null if not a valid relationship field
 */
export function useResourceIdFromField(field: FieldWithRelationship): string | null {
  return useMemo(() => {
    const relationship = field.options?.relationship
    if (!relationship) return null

    // relatedEntityDefinitionId is already in "entity_orders" format = resourceId
    if (relationship.relatedEntityDefinitionId) {
      return relationship.relatedEntityDefinitionId
    }

    // System resource relationship (contact, ticket, etc.)
    if (relationship.relatedModelType) {
      return relationship.relatedModelType
    }

    return null
  }, [field.options?.relationship])
}
