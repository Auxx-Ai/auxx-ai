// apps/web/src/components/data-connectors/ui/field-type-compat.ts

import { FieldType } from '@auxx/database/enums'
import type { FieldType as FieldTypeType } from '@auxx/database/types'
import { isFieldTypeCompatible } from '@auxx/lib/custom-fields/client'
import type { ResourceField } from '@auxx/lib/resources/client'

/**
 * Can the connector sink keep this target field in sync? The sink upserts via
 * `UnifiedCrudHandler`, which silently drops non-creatable values on create and
 * non-updatable values on update — so a field that isn't BOTH creatable and
 * updatable (or is computed/derived) can never be reliably written by an ongoing
 * sync. Such fields (record id, createdAt, ticket number, formula/rollup fields,
 * …) are filtered out of the mapping target pickers. Normal custom fields are
 * creatable + updatable, so the common owned/contributing case is unaffected.
 */
export function isWritableTarget(field: ResourceField): boolean {
  const c = field.capabilities
  return c.creatable && c.updatable && !c.computed
}

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
