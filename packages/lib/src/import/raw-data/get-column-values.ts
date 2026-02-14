// packages/lib/src/import/raw-data/get-column-values.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { and, asc, count, desc, eq } from 'drizzle-orm'

/**
 * Get all values for a specific column in an import job.
 *
 * @param db - Database instance
 * @param jobId - Import job ID
 * @param columnIndex - Column index (0-based)
 * @returns Array of values ordered by row index
 */
export async function getColumnValues(
  db: Database,
  jobId: string,
  columnIndex: number
): Promise<string[]> {
  const rows = await db.query.ImportJobRawData.findMany({
    where: and(
      eq(schema.ImportJobRawData.importJobId, jobId),
      eq(schema.ImportJobRawData.columnIndex, columnIndex)
    ),
    orderBy: asc(schema.ImportJobRawData.rowIndex),
    columns: {
      value: true,
    },
  })

  return rows.map((r) => r.value)
}

/**
 * Get unique values for a column with their hashes and counts.
 * Uses SQL GROUP BY for efficient aggregation instead of fetching all rows.
 *
 * @param db - Database instance
 * @param jobId - Import job ID
 * @param columnIndex - Column index (0-based)
 * @returns Array of { value, hash, count } sorted by count descending
 */
export async function getColumnUniqueValues(
  db: Database,
  jobId: string,
  columnIndex: number
): Promise<Array<{ value: string; hash: string; count: number }>> {
  const results = await db
    .select({
      value: schema.ImportJobRawData.value,
      hash: schema.ImportJobRawData.valueHash,
      count: count(),
    })
    .from(schema.ImportJobRawData)
    .where(
      and(
        eq(schema.ImportJobRawData.importJobId, jobId),
        eq(schema.ImportJobRawData.columnIndex, columnIndex)
      )
    )
    .groupBy(schema.ImportJobRawData.value, schema.ImportJobRawData.valueHash)
    .orderBy(desc(count()))

  return results.map((r) => ({
    value: r.value,
    hash: r.hash,
    count: Number(r.count),
  }))
}
