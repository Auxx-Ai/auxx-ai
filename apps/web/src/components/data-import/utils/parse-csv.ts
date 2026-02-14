// apps/web/src/components/data-import/utils/parse-csv.ts

import Papa from 'papaparse'
import { MAX_FILE_SIZE_BYTES } from '../constants'
import type { ColumnHeader, ParsedCSVData } from '../types'

/** Parse CSV error types */
export interface ParseCSVError {
  type: 'file_too_large' | 'parse_error' | 'empty_file' | 'no_headers'
  message: string
}

/**
 * Parse a CSV file in the browser using PapaParse.
 * Returns headers and all data rows.
 */
export function parseCSV(file: File): Promise<ParsedCSVData> {
  return new Promise((resolve, reject) => {
    // Validate file size
    if (file.size > MAX_FILE_SIZE_BYTES) {
      reject({
        type: 'file_too_large',
        message: `File size (${formatBytes(file.size)}) exceeds maximum of 20MB`,
      } as ParseCSVError)
      return
    }

    Papa.parse(file, {
      header: false,
      skipEmptyLines: true,
      complete: (results) => {
        const allRows = results.data as string[][]

        if (allRows.length === 0) {
          reject({ type: 'empty_file', message: 'CSV file is empty' } as ParseCSVError)
          return
        }

        const [headerRow, ...dataRows] = allRows

        if (!headerRow || headerRow.length === 0) {
          reject({ type: 'no_headers', message: 'CSV file has no headers' } as ParseCSVError)
          return
        }

        // Normalize: trim headers, ensure consistent column count
        const columnCount = headerRow.length
        const headers: ColumnHeader[] = headerRow.map((h, i) => ({
          index: i,
          name: h?.trim() || `Column ${i + 1}`,
        }))

        // Normalize rows to consistent column count
        const normalizedRows = dataRows.map((row) => {
          const normalized = new Array(columnCount).fill('')
          for (let i = 0; i < Math.min(row.length, columnCount); i++) {
            normalized[i] = row[i]?.trim() ?? ''
          }
          return normalized
        })

        resolve({
          headers,
          rows: normalizedRows,
          rowCount: normalizedRows.length,
          columnCount,
        })
      },
      error: (error) => {
        reject({
          type: 'parse_error',
          message: error.message,
        } as ParseCSVError)
      },
    })
  })
}

/**
 * Format bytes to human-readable string.
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
