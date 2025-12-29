// packages/services/src/custom-fields/types.ts

import { ModelTypes, type ModelType, FieldType as FieldTypeEnum } from '@auxx/database/enums'

// Re-export ModelType from @auxx/database for convenience
export { ModelTypes, type ModelType }

/** Supported relationship cardinality types */
export type RelationshipType = 'belongs_to' | 'has_one' | 'has_many' | 'many_to_many'

/**
 * Field types that can be marked as unique identifiers.
 * Only scalar types with clear equality semantics are supported.
 */
export const UNIQUEABLE_FIELD_TYPES = new Set<string>([
  FieldTypeEnum.TEXT,
  FieldTypeEnum.NUMBER,
  FieldTypeEnum.EMAIL,
  FieldTypeEnum.PHONE_INTL,
  FieldTypeEnum.URL,
  // RELATIONSHIP is handled separately - only has_one allowed
])

/**
 * Check if a field type supports uniqueness.
 * @param type - The field type
 * @param relationshipType - For RELATIONSHIP fields, the cardinality
 * @returns True if the field type can be marked as unique
 */
export function canFieldBeUnique(
  type: string,
  relationshipType?: RelationshipType
): boolean {
  if (type === FieldTypeEnum.RELATIONSHIP) {
    return relationshipType === 'has_one'
  }
  return UNIQUEABLE_FIELD_TYPES.has(type)
}

/**
 * Relationship configuration stored in options.relationship
 */
export interface RelationshipConfig {
  relatedEntityDefinitionId: string | null
  relatedModelType: string | null
  inverseFieldId: string | null
  relationshipType: RelationshipType
  displayFieldId: string | null
  isInverse: boolean
}

/**
 * Relationship-specific options for CreateCustomFieldInput
 * When type is RELATIONSHIP, these additional fields are required
 */
export interface RelationshipOptions {
  /** Unified resource ID format (e.g., 'contact', 'entity_product') - preferred */
  relatedResourceId?: string
  /** System resource ModelType (e.g., 'contact', 'ticket') - legacy, use relatedResourceId */
  relatedModelType?: ModelType | null
  /** Custom entity definition UUID - legacy, use relatedResourceId */
  relatedEntityDefinitionId?: string | null
  relationshipType: RelationshipType
  displayFieldId?: string | null
  inverseName: string
  inverseDescription?: string
  inverseIcon?: string
  inverseDisplayFieldId?: string | null
}
