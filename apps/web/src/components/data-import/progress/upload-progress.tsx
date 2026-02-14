// apps/web/src/components/data-import/progress/upload-progress.tsx

'use client'

import { Progress } from '@auxx/ui/components/progress'
import { Upload } from 'lucide-react'
import type { UploadProgress as UploadProgressType } from '../types'

interface UploadProgressProps {
  progress: UploadProgressType
}

/**
 * Progress indicator for chunked file upload.
 */
export function UploadProgress({ progress }: UploadProgressProps) {
  const percentage =
    progress.totalRows > 0 ? Math.round((progress.rowsUploaded / progress.totalRows) * 100) : 0

  return (
    <div className='space-y-4 py-8'>
      <div className='flex items-center justify-center gap-3'>
        <Upload className='h-8 w-8 text-primary animate-pulse' />
        <div>
          <p className='font-medium'>Uploading data...</p>
          <p className='text-sm text-muted-foreground'>
            {progress.rowsUploaded.toLocaleString()} of {progress.totalRows.toLocaleString()} rows
          </p>
        </div>
      </div>

      <Progress value={percentage} className='w-full max-w-md mx-auto' />

      <p className='text-center text-sm text-muted-foreground'>
        Chunk {progress.chunksUploaded} of {progress.totalChunks}
      </p>
    </div>
  )
}
