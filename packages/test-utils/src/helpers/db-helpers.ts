// packages/test-utils/src/helpers/db-helpers.ts
// Common database operations for integration tests

import { sql } from 'drizzle-orm'
import { expect } from 'vitest'
import { getTestDb } from '../globals'

/** Count rows in a table and assert it matches the expected count. */
export async function expectRecordCount(tableName: string, expectedCount: number) {
  const db = getTestDb()
  const result = await db.execute(sql.raw(`SELECT count(*)::int AS count FROM "${tableName}"`))
  const count = (result.rows[0] as { count: number }).count
  expect(count).toBe(expectedCount)
}

/** Truncate a single table with CASCADE. */
export async function truncateTable(tableName: string) {
  const db = getTestDb()
  await db.execute(sql.raw(`TRUNCATE TABLE "${tableName}" CASCADE`))
}

/** Truncate multiple tables at once with CASCADE. */
export async function truncateTables(...tableNames: string[]) {
  if (tableNames.length === 0) return
  const db = getTestDb()
  const quoted = tableNames.map((t) => `"${t}"`).join(', ')
  await db.execute(sql.raw(`TRUNCATE TABLE ${quoted} CASCADE`))
}
