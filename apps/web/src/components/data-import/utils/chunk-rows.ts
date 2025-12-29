// apps/web/src/components/data-import/utils/chunk-rows.ts

import { UPLOAD_CHUNK_SIZE } from '../constants'

/** Single chunk of rows for upload */
export interface RowChunk {
  chunkIndex: number
  totalChunks: number
  startRow: number
  endRow: number
  rows: string[][]
}

/**
 * Split rows into chunks for upload.
 */
export function chunkRows(rows: string[][]): RowChunk[] {
  const chunks: RowChunk[] = []
  const totalChunks = Math.ceil(rows.length / UPLOAD_CHUNK_SIZE)

  for (let i = 0; i < rows.length; i += UPLOAD_CHUNK_SIZE) {
    const chunkRows = rows.slice(i, i + UPLOAD_CHUNK_SIZE)
    chunks.push({
      chunkIndex: chunks.length,
      totalChunks,
      startRow: i,
      endRow: i + chunkRows.length - 1,
      rows: chunkRows,
    })
  }

  return chunks
}
