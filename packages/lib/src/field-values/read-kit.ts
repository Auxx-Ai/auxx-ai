// packages/lib/src/field-values/read-kit.ts
//
// The reader kit re-typed per module: `selectValues`, `fieldIdsOf`, `cellReader`,
// `liveInstanceIds`. Superseded by `resources/system-records` (plan §3b), which
// already owns the alias join; this is the interim home for the rest.

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, eq, inArray, isNull } from 'drizzle-orm'

/** The field ids a module resolved for its attributes, keyed by attribute — `null` where the org lacks the field. */
export type FieldMap<A extends string> = Record<A, { id: string } | null>

/** One `FieldValue` row, in the columns a domain reader needs to type a cell by hand. */
export interface ValueRow {
  entityId: string
  fieldId: string
  valueText: string | null
  valueNumber: number | null
  valueBoolean: boolean | null
  valueDate: string | null
  optionId: string | null
  relatedEntityId: string | null
}

/**
 * `FieldValue` rows for a set of instances and fields, bucketed
 * `instance -> field -> rows`. The inner value is an ARRAY because a has_many
 * field has one row per related record.
 */
export async function selectValues(
  db: Database | Transaction,
  organizationId: string,
  entityIds: readonly string[],
  fieldIds: readonly string[]
): Promise<Map<string, Map<string, ValueRow[]>>> {
  const buckets = new Map<string, Map<string, ValueRow[]>>()
  if (entityIds.length === 0 || fieldIds.length === 0) return buckets

  const rows = await db
    .select({
      entityId: schema.FieldValue.entityId,
      fieldId: schema.FieldValue.fieldId,
      valueText: schema.FieldValue.valueText,
      valueNumber: schema.FieldValue.valueNumber,
      valueBoolean: schema.FieldValue.valueBoolean,
      valueDate: schema.FieldValue.valueDate,
      optionId: schema.FieldValue.optionId,
      relatedEntityId: schema.FieldValue.relatedEntityId,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        inArray(schema.FieldValue.entityId, [...entityIds]),
        inArray(schema.FieldValue.fieldId, [...fieldIds])
      )
    )
    .orderBy(schema.FieldValue.sortKey)

  for (const row of rows) {
    let byField = buckets.get(row.entityId)
    if (!byField) {
      byField = new Map()
      buckets.set(row.entityId, byField)
    }
    const list = byField.get(row.fieldId)
    if (list) list.push(row)
    else byField.set(row.fieldId, [row])
  }
  return buckets
}

/** The field ids of a resolved attribute map, dropping the ones the org lacks. */
export function fieldIdsOf<A extends string>(fields: FieldMap<A>): string[] {
  return Object.values<{ id: string } | null>(fields)
    .filter((field): field is { id: string } => field != null)
    .map((field) => field.id)
}

/** A cell reader bound to one instance's bucket and one attribute map. */
export function cellReader<A extends string>(
  fields: FieldMap<A>,
  bucket: Map<string, ValueRow[]> | undefined
): { cell: (attribute: A) => ValueRow | undefined; cells: (attribute: A) => ValueRow[] } {
  return {
    cell: (attribute) => {
      const field = fields[attribute]
      return field ? bucket?.get(field.id)?.[0] : undefined
    },
    cells: (attribute) => {
      const field = fields[attribute]
      return field ? (bucket?.get(field.id) ?? []) : []
    },
  }
}

/** The ids of every non-archived instance among `ids`, in the order given. */
export async function liveInstanceIds(
  db: Database | Transaction,
  organizationId: string,
  ids: readonly string[]
): Promise<string[]> {
  if (ids.length === 0) return []
  const rows = await db
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        inArray(schema.EntityInstance.id, [...ids]),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
  const live = new Set(rows.map((row) => row.id))
  return ids.filter((id) => live.has(id))
}
