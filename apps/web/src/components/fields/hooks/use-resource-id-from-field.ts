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
 * Contains either tableId (for properly formatted IDs) or apiSlug (for raw slugs that need resolution).
 */
export interface ResourceIdResult {
  /** For system resources (contact, ticket) or entity_xxx format */
  tableId?: string
  /** For raw apiSlug that needs server-side resolution */
  apiSlug?: string
}

/**
 * Hook to extract resource identification from a relationship field.
 * Returns an object with either tableId or apiSlug based on the stored format.
 *
 * The stored value in relatedEntityDefinitionId can be:
 * - UUID (EntityDefinition.id) - treated as apiSlug for server resolution
 * - apiSlug (e.g., "products") - treated as apiSlug
 * - entity_apiSlug (e.g., "entity_products") - treated as tableId
 *
 * @param field - Field definition with relationship options
 * @returns ResourceIdResult or null if not a valid relationship field
 */
export function useResourceIdFromField(field: FieldWithRelationship): ResourceIdResult | null {
  return useMemo(() => {
    const relationship = field.options?.relationship
    if (!relationship) return null

    // System resource (contact, ticket, etc.) - use as tableId directly
    if (relationship.relatedModelType) {
      return { tableId: relationship.relatedModelType }
    }

    // Check relatedEntityDefinitionId
    if (relationship.relatedEntityDefinitionId) {
      const value = relationship.relatedEntityDefinitionId

      // Already in entity_xxx format - use as tableId
      if (value.startsWith('entity_')) {
        return { tableId: value }
      }

      // UUID or raw apiSlug - let server resolve via apiSlug param
      return { apiSlug: value }
    }

    return null
  }, [field.options?.relationship])
}
