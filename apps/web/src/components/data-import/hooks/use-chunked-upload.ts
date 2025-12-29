// apps/web/src/components/data-import/hooks/use-chunked-upload.ts

'use client'

import { useState, useCallback } from 'react'
import { api } from '~/trpc/react'
import { chunkRows } from '../utils/chunk-rows'
import type { UploadProgress, ColumnHeader } from '../types'

interface UseChunkedUploadOptions {
  onComplete?: (jobId: string) => void
  onError?: (error: Error) => void
}

interface UploadParams {
  targetTable: string
  fileName: string
  headers: ColumnHeader[]
  rows: string[][]
}

/**
 * Hook for uploading parsed CSV data in chunks.
 */
export function useChunkedUpload(options: UseChunkedUploadOptions = {}) {
  const [progress, setProgress] = useState<UploadProgress>({
    phase: 'idle',
    parseProgress: 0,
    chunksUploaded: 0,
    totalChunks: 0,
    rowsUploaded: 0,
    totalRows: 0,
    error: null,
  })

  const createJob = api.dataImport.createJob.useMutation()
  const uploadChunk = api.dataImport.uploadChunk.useMutation()
  const finalizeUpload = api.dataImport.finalizeUpload.useMutation()

  const upload = useCallback(
    async ({ targetTable, fileName, headers, rows }: UploadParams) => {
      try {
        const chunks = chunkRows(rows)

        setProgress({
          phase: 'uploading',
          parseProgress: 100,
          chunksUploaded: 0,
          totalChunks: chunks.length,
          rowsUploaded: 0,
          totalRows: rows.length,
          error: null,
        })

        // Create the job first
        const job = await createJob.mutateAsync({
          targetTable,
          fileName,
          headers: headers.map((h) => ({ index: h.index, name: h.name })),
          columnCount: headers.length,
          rowCount: rows.length,
        })

        // Upload chunks sequentially
        for (const chunk of chunks) {
          await uploadChunk.mutateAsync({
            jobId: job.id,
            chunkIndex: chunk.chunkIndex,
            totalChunks: chunk.totalChunks,
            rows: chunk.rows,
          })

          setProgress((prev) => ({
            ...prev,
            chunksUploaded: chunk.chunkIndex + 1,
            rowsUploaded: chunk.endRow + 1,
          }))
        }

        // Finalize the upload
        await finalizeUpload.mutateAsync({ jobId: job.id })

        setProgress((prev) => ({ ...prev, phase: 'complete' }))
        options.onComplete?.(job.id)

        return job.id
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Upload failed'
        setProgress((prev) => ({ ...prev, phase: 'error', error: errorMessage }))
        options.onError?.(error as Error)
        throw error
      }
    },
    [createJob, uploadChunk, finalizeUpload, options]
  )

  const reset = useCallback(() => {
    setProgress({
      phase: 'idle',
      parseProgress: 0,
      chunksUploaded: 0,
      totalChunks: 0,
      rowsUploaded: 0,
      totalRows: 0,
      error: null,
    })
  }, [])

  return { upload, progress, reset }
}
