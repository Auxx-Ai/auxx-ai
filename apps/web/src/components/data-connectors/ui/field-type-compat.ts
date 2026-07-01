// apps/web/src/components/data-connectors/ui/field-type-compat.ts

import { FieldType } from '@auxx/database/enums'
import type { FieldType as FieldTypeType } from '@auxx/database/types'
import { isFieldTypeCompatible } from '@auxx/lib/custom-fields/client'
import type { ResourceField } from '@auxx/lib/resources/client'

/**
 * Can the connector sink keep this target field in sync? Computed/derived fields
 * (formula/rollup) are never writable. Otherwise a field needs to be both creatable
 * and updatable so an ongoing sync can write it on create AND update — that filters
 * out record id, createdAt, ticket number, etc. from the mapping target pickers.
 *
 * `ownedWrite` (the mapping is OWNED) flips this for connector-managed columns: an
 * owned def's own columns are stamped user-read-only (`isCreatable`/`isUpdatable`
 * false) by the v6 template projector, but the owned-mode sink populates them via
 * its bypass crud handler — so they ARE valid targets. Gated to connector/app-owned
 * fields (`dataConnectorId`/`isAppOwned`) so a pure system field (e.g. Created By)
 * on an owned def stays hidden. Contributing mappings keep the strict check.
 */
export function isWritableTarget(field: ResourceField, opts?: { ownedWrite?: boolean }): boolean {
  const c = field.capabilities
  if (c.computed) return false
  if (c.creatable && c.updatable) return true
  return !!opts?.ownedWrite && (field.dataConnectorId != null || !!field.isAppOwned)
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
 *
 * `sourceFieldType` is the leaf's DECLARED field type when it carries one (a struct
 * source like `ADDRESS_STRUCT`). When set it's checked directly, so the target list is
 * exactly that type's accepting sinks (`ADDRESS_STRUCT` → ADDRESS_STRUCT / ADDRESS / JSON)
 * rather than the lossy `object → JSON` widening.
 */
export function isSourceTargetCompatible(
  target: FieldTypeType | null | undefined,
  jsonType: string,
  sourceFieldType?: FieldTypeType
): boolean {
  if (!target) return true
  if (sourceFieldType) return isFieldTypeCompatible(target, sourceFieldType)
  return isFieldTypeCompatible(target, jsonSourceFieldType(jsonType))
}
