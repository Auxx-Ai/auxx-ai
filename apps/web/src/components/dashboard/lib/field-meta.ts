// apps/web/src/components/dashboard/lib/field-meta.ts
//
// Small client helpers for reading a ResourceField's storage FieldType. System
// resource fields (thread/message/article) often carry no `fieldType` — only a
// workflow-engine `BaseType` — so we fall back through `mapBaseTypeToFieldType`,
// matching what the field pickers do. Used by the metric + group-by config rows
// to filter aggregable/groupable fields and to key the op/granularity controls.

import type { FieldType } from '@auxx/database/types'
import type { ResourceField } from '@auxx/lib/resources/client'
import { mapBaseTypeToFieldType } from '@auxx/lib/workflow-engine/client'

/** The field's effective storage FieldType (`fieldType`, else derived from BaseType). */
export function effectiveFieldTypeOf(field: ResourceField): FieldType | undefined {
  if (field.fieldType) return field.fieldType as FieldType
  if (field.type) return mapBaseTypeToFieldType(field.type as never) as FieldType | undefined
  return undefined
}

/** A relationship field can be drilled into for a one-hop group-by. */
export function isRelationshipField(field: ResourceField): boolean {
  return !!field.relationship
}
