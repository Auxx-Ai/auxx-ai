// packages/lib/src/resources/system-records/value-join.ts

import { schema } from '@auxx/database'
import { and, eq, type SQL } from 'drizzle-orm'
import type { AnyPgColumn, alias } from 'drizzle-orm/pg-core'

/** The record a `FieldValue` hangs off: `EntityInstance` itself, or an alias of it a query already joined. */
export interface ValueOwner {
  id: AnyPgColumn
  organizationId: AnyPgColumn
}

/**
 * The `FieldValue` alias join on `(entityId, organizationId, fieldId)`, for the
 * reads that filter or sort on a value in SQL.
 *
 * `owner` is the record the value belongs to. Pass an `alias(schema.EntityInstance, …)`
 * when the value hangs off a record the query joined rather than the one it selects from
 * — a build's order, a line's order.
 */
export function systemValueJoin(
  table: ReturnType<typeof alias<typeof schema.FieldValue, string>>,
  fieldId: string,
  owner: ValueOwner = schema.EntityInstance
): SQL | undefined {
  return and(
    eq(table.entityId, owner.id),
    eq(table.organizationId, owner.organizationId),
    eq(table.fieldId, fieldId)
  )
}

/**
 * A materialised field's id, or a sentinel that matches no row — for the optional
 * fields a static query reaches through a LEFT JOIN, so an unmaterialised one reads
 * `null` instead of forcing a conditional join and a different nullability per branch.
 *
 * 🛑 A missing field is therefore indistinguishable from an empty value. Never use it
 * for a filter whose absence would WIDEN the answer; require that field outright.
 */
export function optionalFieldId(field: { id: string } | null | undefined): string {
  return field?.id ?? '__unmaterialised__'
}
