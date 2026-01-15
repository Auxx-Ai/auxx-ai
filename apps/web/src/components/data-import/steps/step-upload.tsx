// apps/web/src/components/data-import/steps/step-upload.tsx

'use client'

import { useState, useCallback } from 'react'
import { Trash2, AlertCircle, Columns, Rows3 } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { FileSelectDropZone } from '~/components/file-select/file-select-drop-zone'
import { EntityIcon } from '@auxx/ui/components/icons'
import { parseCSV, type ParseCSVError } from '../utils/parse-csv'
import { useChunkedUpload } from '../hooks/use-chunked-upload'
import { MAX_FILE_SIZE_BYTES } from '../constants'
import { formatBytes } from '@auxx/utils/file'
import type { ParsedCSVData } from '../types'

interface StepUploadProps {
  entityDefinitionId: string
  onComplete: (jobId: string) => void
}

/**
 * Step 1: File upload and preview.
 * Parses CSV client-side with PapaParse, shows compact file card, uploads in chunks.
 * Uses the existing FileSelectDropZone component for file selection.
 */
export function StepUpload({ entityDefinitionId, onComplete }: StepUploadProps) {
  const [parsedData, setParsedData] = useState<ParsedCSVData | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [fileSize, setFileSize] = useState<number>(0)
  const [dragActive, setDragActive] = useState(false)

  const { upload, progress, reset } = useChunkedUpload({
    onComplete: (jobId) => onComplete(jobId),
    onError: (error) => setParseError(error.message),
  })

  const handleFilesSelected = useCallback(async (files: File[]) => {
    const file = files[0]
    if (!file) return

    // Validate file size
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setParseError(`File too large. Maximum size is 20MB.`)
      return
    }

    setParseError(null)
    setFileName(file.name)
    setFileSize(file.size)

    try {
      const result = await parseCSV(file)
      setParsedData(result)
    } catch (error) {
      const parseError = error as ParseCSVError
      setParseError(parseError.message)
      setParsedData(null)
    }
  }, [])

  const handleStartUpload = async () => {
    if (!parsedData || !fileName) return

    await upload({
      entityDefinitionId,
      fileName,
      headers: parsedData.headers,
      rows: parsedData.rows,
    })
  }

  const handleReset = () => {
    setParsedData(null)
    setFileName(null)
    setFileSize(0)
    setParseError(null)
    reset()
  }

  const isUploading = progress.phase === 'uploading'
  const isComplete = progress.phase === 'complete'
  const isBusy = isUploading || isComplete
  const uploadPercentage =
    progress.totalRows > 0 ? Math.round((progress.rowsUploaded / progress.totalRows) * 100) : 0

  return (
    <div className="flex flex-col items-center justify-center flex-1 min-h-0 h-full gap-4">
      {/* File drop zone - uses existing component */}
      {!parsedData && (
        <FileSelectDropZone
          onFilesSelected={handleFilesSelected}
          onBrowseExisting={() => {}}
          dragActive={dragActive}
          onDragActiveChange={setDragActive}
          maxFiles={1}
          fileExtensions={['.csv']}
          placeholder="Drop a CSV file here or click to select"
          showFilePicker={false}
          className="flex-1"
        />
      )}

      {/* Parse error */}
      {parseError && (
        <Alert variant="destructive" className="max-w-[360px] mt-4 ">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{parseError}</AlertDescription>
        </Alert>
      )}

      {/* File preview card - compact centered design */}
      {parsedData && (
        <div className="w-full max-w-[360px] border rounded-2xl overflow-hidden">
          {/* Top row: file info + trash button */}
          <div className="flex items-center justify-between p-4 border-b">
            <div className="flex items-center gap-3 min-w-0">
              <EntityIcon iconId="file-spreadsheet" variant="muted" />
              <div className="min-w-0">
                <p className="font-medium text-sm truncate">{fileName}</p>
                <p className="text-sm text-muted-foreground">CSV • {formatBytes(fileSize)}</p>
              </div>
            </div>
            <Button variant="destructive-hover" size="icon-sm" onClick={handleReset}>
              <Trash2 />
            </Button>
          </div>

          {/* Bottom row: two stat boxes */}
          <div className="grid grid-cols-2 divide-x">
            <div className="p-4 text-center">
              <div className="flex items-center justify-center gap-2 text-muted-foreground mb-1">
                <Columns className="size-4" />
                <span className="text-xs font-medium">Columns</span>
              </div>
              <p className="text-2xl font-bold">{parsedData.columnCount}</p>
            </div>
            <div className="p-4 text-center">
              <div className="flex items-center justify-center gap-2 text-muted-foreground mb-1">
                <Rows3 className="size-4" />
                <span className="text-xs font-medium">Rows</span>
              </div>
              <p className="text-2xl font-bold">
                {isBusy
                  ? `${progress.rowsUploaded.toLocaleString()}/${progress.totalRows.toLocaleString()}`
                  : parsedData.rowCount.toLocaleString()}
              </p>
            </div>
          </div>

          {/* Continue button */}
          <div className="p-4 border-t bg-muted/30">
            <Button
              onClick={handleStartUpload}
              disabled={isBusy}
              className="relative w-full overflow-hidden"
            >
              <div
                className="absolute inset-0 bg-primary/30 pointer-events-none transition-all duration-300"
                style={{ width: isBusy ? `${uploadPercentage}%` : '0%' }}
              />
              <span className="relative z-10">
                {isComplete
                  ? 'Complete!'
                  : isUploading
                    ? `Chunk ${progress.chunksUploaded} of ${progress.totalChunks}`
                    : 'Upload & Continue'}
              </span>
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
