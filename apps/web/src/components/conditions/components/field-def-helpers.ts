// apps/web/src/components/conditions/components/field-def-helpers.ts

import type { ResourceField } from '@auxx/lib/resources/client'
import { getFieldOperators } from '@auxx/lib/resources/client'
import { getRelatedEntityDefinitionId, type RelationshipConfig } from '@auxx/types/custom-field'
import type { FieldReference } from '@auxx/types/field'
import type { FieldDefinition } from '../types'

/**
 * Convert a {@link ResourceField} surfaced by the field picker into the condition
 * system's {@link FieldDefinition}. Shared by `NavigableFieldSelector` (single-root)
 * and `ProcedureFieldSelector` (multi-root) so the two never diverge.
 */
export function resourceFieldToFieldDef(
  field: ResourceField,
  fieldReference: FieldReference
): FieldDefinition {
  const id = Array.isArray(fieldReference) ? fieldReference.join('::') : (fieldReference as string)

  return {
    id,
    label: field.label,
    type: field.type,
    fieldType: field.fieldType,
    operators: getFieldOperators(field) as any[],
    options: field.options,
    fieldKey: field.key,
    fieldReference: field.resourceFieldId,
    targetEntityDefinitionId: field.relationship
      ? (getRelatedEntityDefinitionId(field.relationship as RelationshipConfig) ?? undefined)
      : undefined,
  }
}
