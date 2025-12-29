// packages/lib/src/import/raw-data/store-raw-data.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { hashValue } from '../hashing/hash-value'

/** Batch size for inserting raw data */
const BATCH_SIZE = 500

/**
 * Store raw CSV cell data in the database.
 * Computes hashes for each value during storage.
 *
 * @param db - Database instance
 * @param jobId - Import job ID
 * @param rows - Array of rows, where each row is an array of cell values by column index
 * @param onProgress - Optional progress callback (rowsProcessed, totalRows)
 */
export async function storeRawData(
  db: Database,
  jobId: string,
  rows: string[][],
  onProgress?: (processed: number, total: number) => void
): Promise<void> {
  if (rows.length === 0) {
    return
  }

  const columnCount = rows[0].length
  let processedRows = 0

  // Process in batches to avoid memory issues
  for (let batchStart = 0; batchStart < rows.length; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, rows.length)
    const batchRows = rows.slice(batchStart, batchEnd)

    const insertData: Array<{
      importJobId: string
      rowIndex: number
      columnIndex: number
      value: string
      valueHash: string
    }> = []

    for (let rowOffset = 0; rowOffset < batchRows.length; rowOffset++) {
      const row = batchRows[rowOffset]
      const rowIndex = batchStart + rowOffset

      for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
        const value = row[columnIndex] ?? ''
        insertData.push({
          importJobId: jobId,
          rowIndex,
          columnIndex,
          value,
          valueHash: hashValue(value),
        })
      }
    }

    await db.insert(schema.ImportJobRawData).values(insertData)

    processedRows += batchRows.length
    onProgress?.(processedRows, rows.length)
  }
}

/**
 * Store a single chunk of raw data (for chunked uploads).
 *
 * @param db - Database instance
 * @param jobId - Import job ID
 * @param rows - Array of rows for this chunk
 * @param startRowIndex - Starting row index for this chunk
 */
export async function storeRawDataChunk(
  db: Database,
  jobId: string,
  rows: string[][],
  startRowIndex: number
): Promise<void> {
  if (rows.length === 0) {
    return
  }

  const columnCount = rows[0].length

  const insertData: Array<{
    importJobId: string
    rowIndex: number
    columnIndex: number
    value: string
    valueHash: string
  }> = []

  for (let rowOffset = 0; rowOffset < rows.length; rowOffset++) {
    const row = rows[rowOffset]
    const rowIndex = startRowIndex + rowOffset

    for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
      const value = row[columnIndex] ?? ''
      insertData.push({
        importJobId: jobId,
        rowIndex,
        columnIndex,
        value,
        valueHash: hashValue(value),
      })
    }
  }

  // Insert in smaller batches if very large
  for (let i = 0; i < insertData.length; i += 1000) {
    const batch = insertData.slice(i, i + 1000)
    await db.insert(schema.ImportJobRawData).values(batch)
  }
}
