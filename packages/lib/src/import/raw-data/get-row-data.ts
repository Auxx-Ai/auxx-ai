// packages/lib/src/import/raw-data/get-row-data.ts

import { eq, and, asc, inArray } from 'drizzle-orm'
import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'

/**
 * Get all values for a specific row in an import job.
 *
 * @param db - Database instance
 * @param jobId - Import job ID
 * @param rowIndex - Row index (0-based)
 * @returns Map of columnIndex → value
 */
export async function getRowData(
  db: Database,
  jobId: string,
  rowIndex: number
): Promise<Record<number, string>> {
  const cells = await db.query.ImportJobRawData.findMany({
    where: and(
      eq(schema.ImportJobRawData.importJobId, jobId),
      eq(schema.ImportJobRawData.rowIndex, rowIndex)
    ),
    orderBy: asc(schema.ImportJobRawData.columnIndex),
    columns: {
      columnIndex: true,
      value: true,
    },
  })

  const result: Record<number, string> = {}
  for (const cell of cells) {
    result[cell.columnIndex] = cell.value
  }

  return result
}

/**
 * Get data for multiple rows at once (batch operation).
 *
 * @param db - Database instance
 * @param jobId - Import job ID
 * @param rowIndices - Array of row indices
 * @returns Map of rowIndex → { columnIndex: value }
 */
export async function getBatchRowData(
  db: Database,
  jobId: string,
  rowIndices: number[]
): Promise<Map<number, Record<number, string>>> {
  if (rowIndices.length === 0) {
    return new Map()
  }

  const cells = await db.query.ImportJobRawData.findMany({
    where: and(
      eq(schema.ImportJobRawData.importJobId, jobId),
      inArray(schema.ImportJobRawData.rowIndex, rowIndices)
    ),
    orderBy: [asc(schema.ImportJobRawData.rowIndex), asc(schema.ImportJobRawData.columnIndex)],
    columns: {
      rowIndex: true,
      columnIndex: true,
      value: true,
    },
  })

  const result = new Map<number, Record<number, string>>()

  for (const cell of cells) {
    if (!result.has(cell.rowIndex)) {
      result.set(cell.rowIndex, {})
    }
    result.get(cell.rowIndex)![cell.columnIndex] = cell.value
  }

  return result
}
