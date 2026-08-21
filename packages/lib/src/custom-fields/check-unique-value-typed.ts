// packages/lib/src/custom-fields/check-unique-value-typed.ts

import { type Database, database, schema, type Transaction } from '@auxx/database'
import type { TypedFieldValueInput } from '@auxx/types'
import { and, eq, isNull, ne, sql } from 'drizzle-orm'
import { UniqueValueConflictError } from '../errors'
import { parseRecordId } from '../resources/resource-id'

/**
 * Input for checking if a value is unique for a field.
 *
 * `FieldValue.fieldId` is an FK to `CustomField.id` (a primary key), so
 * `fieldId` + `organizationId` alone pin the exact field. The check
 * deliberately takes NO `modelType`/`entityDefinitionId` scope: seeded
 * system fields carry their entity type as `CustomField.modelType`
 * (e.g. `'contact'`) while callers deriving a scope from the record's
 * def id get `'entity'` — a mismatched predicate silently emptied the
 * query and let duplicates through the `fieldValue.set` door.
 */
export interface CheckUniqueValueTypedInput {
  fieldId: string
  value: TypedFieldValueInput | TypedFieldValueInput[] | null
  organizationId: string
  excludeEntityId?: string
}

/**
 * Check if a typed field value is unique within its scope.
 * Uses the new FieldValue table with typed columns.
 *
 * Array inputs (multi-value fields, `options.multi`) are checked PER VALUE —
 * every element must be unique org-wide. Archived records are excluded (merge
 * archives sources whose FieldValue rows survive; counting them would
 * false-conflict edits of the surviving record).
 *
 * @param input - Check parameters
 * @returns True if value is unique, throws {@link UniqueValueConflictError} if not
 */
export async function checkUniqueValueTyped(
  input: CheckUniqueValueTypedInput,
  db: Database | Transaction = database
): Promise<boolean> {
  const { fieldId, value, organizationId, excludeEntityId } = input

  // Null values are always allowed (no uniqueness constraint)
  if (value === null) {
    return true
  }

  // Multi-value fields: every element must individually pass. This is the
  // panel/bulk-edit door's ONLY uniqueness gate for arrays — returning true
  // here would let a claimed email in via `fieldValue.set`.
  if (Array.isArray(value)) {
    for (const element of value) {
      await checkUniqueValueTyped({ ...input, value: element }, db)
    }
    return true
  }

  // Build the value condition based on type
  let valueCondition: ReturnType<typeof sql> | undefined

  switch (value.type) {
    case 'text':
      valueCondition = eq(schema.FieldValue.valueText, value.value)
      break
    case 'number':
      valueCondition = eq(schema.FieldValue.valueNumber, value.value)
      break
    case 'boolean':
      valueCondition = eq(schema.FieldValue.valueBoolean, value.value)
      break
    case 'date':
      valueCondition = eq(
        schema.FieldValue.valueDate,
        typeof value.value === 'string' ? value.value : value.value.toISOString()
      )
      break
    case 'option':
      valueCondition = eq(schema.FieldValue.optionId, value.optionId)
      break
    case 'relationship':
      // The input carries a RecordId (`entityDefinitionId:entityInstanceId`); the
      // column stores the bare instance id. Mirrors `typedColumnMatch`, which is
      // the canonical (column, value) mapping for the write path.
      valueCondition = eq(
        schema.FieldValue.relatedEntityId,
        parseRecordId(value.recordId).entityInstanceId
      )
      break
    case 'json':
      // JSON fields are not typically unique, but support it anyway.
      // `valueJson` is an envelope — compare `->'v'` (the value), and compare it
      // as jsonb rather than ::text so key order does not decide equality.
      valueCondition = sql`${schema.FieldValue.valueJson}->'v' = ${JSON.stringify(value.value)}::jsonb`
      break
  }

  if (!valueCondition) {
    return true
  }

  // Query for existing values with the same value. The EntityInstance join
  // excludes archived records from the check. No CustomField join: fieldId
  // is the CustomField PK, so any extra modelType/entityDefinitionId
  // predicate can only wrongly EXCLUDE the conflicting row (fail open).
  const query = db
    .select({
      entityId: schema.FieldValue.entityId,
      displayName: schema.EntityInstance.displayName,
    })
    .from(schema.FieldValue)
    .innerJoin(schema.EntityInstance, eq(schema.EntityInstance.id, schema.FieldValue.entityId))
    .where(
      and(
        eq(schema.FieldValue.fieldId, fieldId),
        eq(schema.FieldValue.organizationId, organizationId),
        isNull(schema.EntityInstance.archivedAt),
        excludeEntityId ? ne(schema.FieldValue.entityId, excludeEntityId) : undefined,
        valueCondition
      )
    )
    .limit(1)

  const result = await query

  const existing = result[0]
  if (existing) {
    const conflictingValue =
      value.type === 'option'
        ? value.optionId
        : value.type === 'relationship'
          ? value.recordId
          : 'value' in value
            ? String(value.value)
            : JSON.stringify(value)
    const owner = existing.displayName ? ` on "${existing.displayName}"` : ''
    throw new UniqueValueConflictError({
      message: `Value already exists${owner}: ${conflictingValue}`,
      conflictingValue,
      fieldId,
      existingEntityId: existing.entityId,
    })
  }

  return true
}
