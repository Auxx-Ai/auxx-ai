// apps/web/src/components/data-connectors/ui/field-type-compat.ts

import { FieldType } from '@auxx/database/enums'
import type { FieldType as FieldTypeType } from '@auxx/database/types'
import { isFieldTypeCompatible } from '@auxx/lib/custom-fields/client'

/**
 * A connector source leaf's JSON-schema type → the representative
 * {@link FieldType} its values carry, so it can be checked against a target
 * field via the shared {@link isFieldTypeCompatible} matrix.
 */
function jsonSourceFieldType(jsonType: string): FieldTypeType {
  switch (jsonType) {
    case 'number':
    case 'integer':
      return FieldType.NUMBER
    case 'boolean':
      return FieldType.CHECKBOX
    case 'array':
      return FieldType.TAGS
    case 'object':
      return FieldType.JSON
    default:
      return FieldType.TEXT
  }
}

/**
 * Can a source value be written into a `target` field? Returns `true` for a
 * null/unknown target type (don't hide a field we can't classify).
 *
 * `jsonType` is a source leaf's JSON-schema type. A computed formula has no
 * single source type — it produces a scalar string/number, so pass `'string'`
 * (→ TEXT) for formula targets.
 */
export function isSourceTargetCompatible(
  target: FieldTypeType | null | undefined,
  jsonType: string
): boolean {
  if (!target) return true
  return isFieldTypeCompatible(target, jsonSourceFieldType(jsonType))
}
