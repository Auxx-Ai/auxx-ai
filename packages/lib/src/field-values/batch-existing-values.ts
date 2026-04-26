// packages/lib/src/field-values/batch-existing-values.ts

import { type Database, schema } from '@auxx/database'
import type { FieldType } from '@auxx/database/types'
import { isArrayReturnFieldType, type TypedFieldValue } from '@auxx/types'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { rowsToTypedValues } from './field-value-helpers'
import type { CachedField, FieldValueRow } from './types'

/**
 * Captured pre-write field values, indexed for cheap (entityId, fieldId)
 * lookup by the bulk dispatch path. Inner map values are:
 * - `null` when no row existed pre-write
 * - `TypedFieldValue` for single-value fields
 * - `TypedFieldValue[]` for array-return fields (FILE, TAGS, MULTI_SELECT,
 *   RELATIONSHIP, multi-ACTOR, opt-in `multi`)
 */
export type ExistingFieldValuesMap = Map<
  string,
  Map<string, TypedFieldValue | TypedFieldValue[] | null>
>

/**
 * Batch-fetch the existing typed field values for every (entityId, fieldId)
 * pair the bulk caller is about to write. One query per bulk op, grouped in
 * memory and converted via `rowsToTypedValues` using the already-loaded
 * cached field map.
 *
 * Mirrors `batchGetExistingRelatedIds` for non-relationship fields. Returns
 * an empty inner map for entities that have no rows for any of the fields.
 */
export async function batchGetExistingFieldValues(
  ctx: { db: Database; organizationId: string },
  entityIds: string[],
  fieldIds: string[],
  fieldById: Map<string, CachedField>
): Promise<ExistingFieldValuesMap> {
  const result: ExistingFieldValuesMap = new Map()
  if (entityIds.length === 0 || fieldIds.length === 0) return result

  // Initialise every entity → empty inner map so callers can rely on the
  // outer key existing.
  for (const entityId of entityIds) {
    result.set(entityId, new Map())
  }

  const rows = (await ctx.db
    .select()
    .from(schema.FieldValue)
    .where(
      and(
        inArray(schema.FieldValue.entityId, entityIds),
        inArray(schema.FieldValue.fieldId, fieldIds),
        eq(schema.FieldValue.organizationId, ctx.organizationId)
      )
    )
    .orderBy(asc(schema.FieldValue.sortKey))) as unknown as FieldValueRow[]

  // Group by (entityId, fieldId) in insertion order (already sortKey-ordered).
  const grouped = new Map<string, Map<string, FieldValueRow[]>>()
  for (const row of rows) {
    let perEntity = grouped.get(row.entityId)
    if (!perEntity) {
      perEntity = new Map()
      grouped.set(row.entityId, perEntity)
    }
    const arr = perEntity.get(row.fieldId) ?? []
    arr.push(row)
    perEntity.set(row.fieldId, arr)
  }

  for (const [entityId, perField] of grouped) {
    const inner = result.get(entityId) ?? new Map()
    for (const [fieldId, fieldRows] of perField) {
      const field = fieldById.get(fieldId)
      if (!field) continue
      const fieldType = field.type as FieldType
      const fieldOptions = field.options as
        | { actor?: { multiple?: boolean }; multi?: boolean }
        | undefined
      const isArrayReturn = isArrayReturnFieldType(fieldType, fieldOptions)
      inner.set(fieldId, rowsToTypedValues(fieldRows, fieldType, isArrayReturn))
    }
    result.set(entityId, inner)
  }

  return result
}
