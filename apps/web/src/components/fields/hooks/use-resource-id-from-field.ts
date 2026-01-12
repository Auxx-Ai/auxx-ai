// apps/web/src/components/fields/hooks/use-resource-id-from-field.ts

import { useMemo } from 'react'
import type { RelationshipConfig } from '@auxx/types/custom-field'

/**
 * Field structure with optional relationship options
 */
interface FieldWithRelationship {
  options?: {
    relationship?: Pick<RelationshipConfig, 'relatedEntityDefinitionId'>
  }
}

/**
 * Result from useResourceIdFromField hook.
 * Contains entityDefinitionId (system resource ID or custom entity UUID).
 */
export interface ResourceIdResult {
  /** Entity definition ID - system resource ID or custom entity UUID */
  entityDefinitionId: string
}

/**
 * Hook to extract resource identification from a relationship field.
 * Returns entityDefinitionId which is either a system resource ID or custom entity UUID.
 *
 * The stored value in relatedEntityDefinitionId is:
 * - System resource ID (contact, ticket, etc.) - used directly as entityDefinitionId
 * - UUID (EntityDefinition.id) - used directly as entityDefinitionId
 *
 * @param field - Field definition with relationship options
 * @returns ResourceIdResult or null if not a valid relationship field
 */
export function useResourceIdFromField(field: FieldWithRelationship): ResourceIdResult | null {
  return useMemo(() => {
    const relationship = field.options?.relationship
    if (!relationship) return null

    // relatedEntityDefinitionId is the unified ID for both system and custom resources
    if (relationship.relatedEntityDefinitionId) {
      return { entityDefinitionId: relationship.relatedEntityDefinitionId }
    }

    return null
  }, [field.options?.relationship])
}
