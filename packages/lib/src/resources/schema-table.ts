// packages/lib/src/resources/schema-table.ts

import { schema } from '@auxx/database'
import { getTableName, is } from 'drizzle-orm'
import { type PgColumn, PgTable } from 'drizzle-orm/pg-core'

/**
 * A Drizzle table reached dynamically through the registry's `dbName`.
 *
 * `ResourceTableDefinition.dbName` is a plain `string` (it comes from
 * `ModelTypeMeta[...].dbTable`), so neither the table nor its column set can be
 * resolved statically. This is the shape the dynamic resource paths index by
 * column key — every access is still a `PgColumn`, never `any`.
 */
export type DynamicTable = PgTable & Record<string, PgColumn>

/** Row shape returned by a dynamically-resolved query — keys are column names. */
export type DynamicRow = Record<string, unknown>

/**
 * Resolve a registry `dbName` to its Drizzle table.
 *
 * Throws rather than returning `undefined`: every `dbName` in
 * `RESOURCE_TABLE_MAP` is a `@auxx/database` schema export, so a miss is a
 * registry bug and not something a caller can recover from.
 */
export function resolveSchemaTable(dbName: string): DynamicTable {
  const table = (schema as Record<string, unknown>)[dbName]
  if (!is(table, PgTable)) {
    throw new Error(`Unknown database table: ${dbName}`)
  }
  return table as DynamicTable
}

/**
 * Resolve a column on a dynamically-reached table.
 *
 * Throws rather than letting `undefined` reach the query builder: a display
 * config that names a column its table doesn't have is a registry bug, and
 * feeding `undefined` to `eq`/`ilike`/`desc` builds SQL that matches nothing.
 */
export function requireColumn(table: DynamicTable, columnKey: string): PgColumn {
  const column = table[columnKey]
  if (!column) {
    throw new Error(`Unknown column '${columnKey}' on table '${getTableName(table)}'`)
  }
  return column
}
