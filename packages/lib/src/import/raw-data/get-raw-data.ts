// packages/lib/src/import/raw-data/get-raw-data.ts

import { eq, asc } from 'drizzle-orm'
import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'

/** Raw data record from database */
export interface RawDataCell {
  rowIndex: number
  columnIndex: number
  value: string
  valueHash: string
}

/**
 * Get all raw data for an import job.
 * Returns cells ordered by row, then column.
 *
 * @param db - Database instance
 * @param jobId - Import job ID
 * @returns Array of raw data cells
 */
export async function getRawData(db: Database, jobId: string): Promise<RawDataCell[]> {
  const data = await db.query.ImportJobRawData.findMany({
    where: eq(schema.ImportJobRawData.importJobId, jobId),
    orderBy: [asc(schema.ImportJobRawData.rowIndex), asc(schema.ImportJobRawData.columnIndex)],
    columns: {
      rowIndex: true,
      columnIndex: true,
      value: true,
      valueHash: true,
    },
  })

  return data
}

/**
 * Get raw data as a 2D array (rows × columns).
 *
 * @param db - Database instance
 * @param jobId - Import job ID
 * @returns 2D array where result[rowIndex][columnIndex] = value
 */
export async function getRawDataAsArray(db: Database, jobId: string): Promise<string[][]> {
  const cells = await getRawData(db, jobId)

  if (cells.length === 0) {
    return []
  }

  // Find dimensions
  let maxRow = 0
  let maxColumn = 0
  for (const cell of cells) {
    if (cell.rowIndex > maxRow) maxRow = cell.rowIndex
    if (cell.columnIndex > maxColumn) maxColumn = cell.columnIndex
  }

  // Initialize array
  const result: string[][] = Array.from({ length: maxRow + 1 }, () =>
    Array.from({ length: maxColumn + 1 }, () => '')
  )

  // Fill in values
  for (const cell of cells) {
    result[cell.rowIndex][cell.columnIndex] = cell.value
  }

  return result
}

/**
 * Get raw data as a map from row index to record data.
 * Each record is a map of column index → value.
 *
 * @param db - Database instance
 * @param jobId - Import job ID
 * @returns Map of rowIndex → { columnIndex: value }
 */
export async function getRawDataAsMap(
  db: Database,
  jobId: string
): Promise<Map<number, Record<number, string>>> {
  const cells = await getRawData(db, jobId)
  const result = new Map<number, Record<number, string>>()

  for (const cell of cells) {
    if (!result.has(cell.rowIndex)) {
      result.set(cell.rowIndex, {})
    }
    result.get(cell.rowIndex)![cell.columnIndex] = cell.value
  }

  return result
}
