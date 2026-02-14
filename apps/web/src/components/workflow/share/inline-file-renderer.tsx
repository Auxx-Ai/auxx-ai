// apps/web/src/components/workflow/share/inline-file-renderer.tsx
'use client'

import type { WorkflowFileData } from '@auxx/lib/workflow-engine/types/file-variable'
import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { formatBytes } from '@auxx/utils/file'
import { AlertCircle, Download, ExternalLink, FileIcon, ImageIcon } from 'lucide-react'
import { useState } from 'react'

/**
 * Props for InlineFileRenderer
 */
interface InlineFileRendererProps {
  file: WorkflowFileData
  className?: string
}

/**
 * Check if file is an image based on MIME type
 */
function isImageFile(mimeType: string): boolean {
  return mimeType.startsWith('image/')
}

/**
 * Image preview component with error handling
 */
function ImagePreview({ file, className }: InlineFileRendererProps) {
  const [hasError, setHasError] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  if (hasError) {
    return (
      <div className={cn('flex items-center gap-2 rounded-lg border bg-muted/50 p-3', className)}>
        <AlertCircle className='size-4 text-muted-foreground' />
        <span className='text-sm text-muted-foreground'>Failed to load image</span>
        <a
          href={file.url}
          target='_blank'
          rel='noopener noreferrer'
          className='ml-auto text-sm text-primary hover:underline'>
          Open link
        </a>
      </div>
    )
  }

  return (
    <div className={cn('relative inline-block', className)}>
      {isLoading && (
        <div className='absolute inset-0 flex items-center justify-center rounded-lg bg-muted/50'>
          <div className='size-6 animate-spin rounded-full border-2 border-primary border-t-transparent' />
        </div>
      )}
      <a href={file.url} target='_blank' rel='noopener noreferrer' className='group block'>
        <img
          src={file.url}
          alt={file.filename}
          className={cn(
            'max-h-64 max-w-full rounded-lg border object-contain transition-opacity',
            'group-hover:opacity-90',
            isLoading && 'invisible'
          )}
          onLoad={() => setIsLoading(false)}
          onError={() => {
            setIsLoading(false)
            setHasError(true)
          }}
        />
        <div className='mt-1 flex items-center gap-1 text-xs text-muted-foreground'>
          <ImageIcon className='size-3' />
          <span className='truncate'>{file.filename}</span>
          <span>({formatBytes(file.size)})</span>
          <ExternalLink className='ml-auto size-3 opacity-0 transition-opacity group-hover:opacity-100' />
        </div>
      </a>
    </div>
  )
}

/**
 * Download card for non-image files
 */
function DownloadCard({ file, className }: InlineFileRendererProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-3 rounded-lg border bg-background p-3 transition-colors hover:bg-muted/50',
        className
      )}>
      <div className='flex size-10 items-center justify-center rounded-md bg-muted'>
        <FileIcon className='size-5 text-muted-foreground' />
      </div>
      <div className='min-w-0 flex-1'>
        <p className='truncate text-sm font-medium'>{file.filename}</p>
        <p className='text-xs text-muted-foreground'>{formatBytes(file.size)}</p>
      </div>
      <Button variant='ghost' size='sm' asChild>
        <a href={file.url} download={file.filename} target='_blank' rel='noopener noreferrer'>
          <Download className='size-4' />
        </a>
      </Button>
    </div>
  )
}

/**
 * Inline file renderer - renders single file as image preview or download card
 */
export function InlineFileRenderer({ file, className }: InlineFileRendererProps) {
  if (isImageFile(file.mimeType)) {
    return <ImagePreview file={file} className={className} />
  }

  return <DownloadCard file={file} className={className} />
}

/**
 * Props for InlineFileArrayRenderer
 */
interface InlineFileArrayRendererProps {
  files: WorkflowFileData[]
  className?: string
}

/**
 * Render multiple files in a grid layout
 */
export function InlineFileArrayRenderer({ files, className }: InlineFileArrayRendererProps) {
  if (files.length === 0) return null

  return (
    <div className={cn('flex flex-wrap gap-3', className)}>
      {files.map((file, index) => (
        <InlineFileRenderer key={file.id || index} file={file} />
      ))}
    </div>
  )
}
