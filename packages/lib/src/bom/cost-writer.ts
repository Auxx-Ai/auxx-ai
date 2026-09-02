// packages/lib/src/bom/cost-writer.ts
//
// The one-statement-per-kind writer behind `persistCosts`. Cost fields are
// single-value system fields with no hooks, no display role and no
// search-corpus membership, so a batch of (part, field) writes is exactly
// two statements: one UPDATE over every pair that has a stored row, one
// INSERT for every pair that does not. It used to be one locked transaction
// PER FIELD PER PART, opened in parallel across pool connections
// (plans/field-values/update-path-and-events.md section 1f).

import { database, schema } from '@auxx/database'
import type { FieldType } from '@auxx/database/types'
import type { RecordId } from '@auxx/types/resource'
import { nKeysAfter } from '@auxx/utils/fractional-indexing'
import { sql } from 'drizzle-orm'
import { buildFieldValueRow } from '../field-values/field-value-mutations'
import { parseRecordId } from '../resources/resource-id'

/** One (part, field) value to store, with the stored row id when there is one. */
export interface CostWrite {
  recordId: RecordId
  fieldId: string
  fieldType: FieldType
  value: { type: 'number'; value: number } | { type: 'option'; optionId: string } | null
  /** The pair's stored row, matched by id so a stale snapshot can never widen the write. */
  rowId: string | null
}

/**
 * Store a batch of cost values. A `null` on a stored pair is written as a
 * null number, matching what the per-field path stored; a `null` on a pair
 * with no row inserts nothing, because there is nothing to clear. A manual
 * write clears any AI marker, as every set-shaped write does.
 */
export async function writeCostValues(
  orgId: string,
  partDefId: string,
  writes: readonly CostWrite[]
): Promise<void> {
  const now = new Date()
  const updates: Array<{ id: string; valueNumber: number | null; optionId: string | null }> = []
  const inserts: Array<typeof schema.FieldValue.$inferInsert> = []
  for (const write of writes) {
    const valueNumber = write.value?.type === 'number' ? write.value.value : null
    const optionId = write.value?.type === 'option' ? write.value.optionId : null
    if (write.rowId) {
      updates.push({ id: write.rowId, valueNumber, optionId })
    } else if (write.value !== null) {
      inserts.push(
        buildFieldValueRow({
          organizationId: orgId,
          entityId: parseRecordId(write.recordId).entityInstanceId,
          entityDefinitionId: partDefId,
          fieldId: write.fieldId,
          fieldType: write.fieldType,
          value: write.value,
          sortKey: nKeysAfter(null, 1)[0]!,
        })
      )
    }
  }

  if (updates.length > 0) {
    // Parameters inside a VALUES list default to text; the casts give the
    // columns their own types.
    const rows = sql.join(
      updates.map(
        (u) => sql`(${u.id}::text, ${u.valueNumber}::double precision, ${u.optionId}::text)`
      ),
      sql`, `
    )
    await database.execute(sql`
      UPDATE "FieldValue" AS fv
      SET "valueNumber" = v.num,
          "optionId" = v.opt,
          "valueText" = NULL,
          "valueJson" = NULL,
          "aiStatus" = NULL,
          "updatedAt" = ${now}
      FROM (VALUES ${rows}) AS v(id, num, opt)
      WHERE fv.id = v.id AND fv."organizationId" = ${orgId}
    `)
  }

  if (inserts.length > 0) {
    await database
      .insert(schema.FieldValue)
      .values(inserts)
      .onConflictDoUpdate({
        target: [schema.FieldValue.entityId, schema.FieldValue.fieldId, schema.FieldValue.sortKey],
        set: {
          valueNumber: sql`excluded."valueNumber"`,
          optionId: sql`excluded."optionId"`,
          valueText: null,
          valueJson: null,
          aiStatus: null,
          updatedAt: now,
        },
      })
  }
}
