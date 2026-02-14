// apps/web/src/components/workflow/share/execution-result-card.tsx
'use client'

import type { ContentSegment, WorkflowFileData } from '@auxx/lib/workflow-engine/types'
import { Button } from '@auxx/ui/components/button'
import { useCopy } from '@auxx/ui/hooks/use-copy'
import { cn } from '@auxx/ui/lib/utils'
import { Check, CheckCircle, Copy, Loader2, XCircle } from 'lucide-react'
import { ContentSegmentRenderer } from './content-segment-renderer'
import type { EndNodeResult } from './workflow-share-provider'

/**
 * Convert a single file to markdown format
 * Images use ![filename](url), other files use [filename](url)
 */
function fileToMarkdown(file: WorkflowFileData): string {
  const isImage = file.mimeType.startsWith('image/')
  return isImage ? `![${file.filename}](${file.url})` : `[${file.filename}](${file.url})`
}

/**
 * Convert content segments to markdown string for copying
 * Text stays as text, files become markdown links/images
 */
function segmentsToMarkdown(segments: ContentSegment[]): string {
  return segments
    .map((segment) => {
      switch (segment.type) {
        case 'text':
          return segment.value
        case 'file':
          return fileToMarkdown(segment.value)
        case 'file-array':
          return segment.value.map(fileToMarkdown).join('\n')
        default:
          return ''
      }
    })
    .join('')
}

/**
 * Props for ExecutionResultCard
 */
interface ExecutionResultCardProps {
  result: EndNodeResult
  className?: string
}

/**
 * Status badge component for upper right corner
 */
function StatusBadge({ status }: { status: EndNodeResult['status'] }) {
  if (status === 'running') {
    return (
      <div className='flex items-center gap-1.5 text-xs text-muted-foreground'>
        <Loader2 className='size-3 animate-spin' />
        <span>Running</span>
      </div>
    )
  }

  if (status === 'completed') {
    return (
      <div className='flex items-center gap-1.5 text-xs text-green-600'>
        <CheckCircle className='size-3' />
        <span>Completed</span>
      </div>
    )
  }

  if (status === 'failed') {
    return (
      <div className='flex items-center gap-1.5 text-xs text-destructive'>
        <XCircle className='size-3' />
        <span>Failed</span>
      </div>
    )
  }

  return null
}

/**
 * Chat-bubble style card for displaying workflow execution results
 * Shows the End node's message output in a clean, readable format
 * Status badge in upper right corner
 * Supports rich content with inline file rendering
 */
export function ExecutionResultCard({ result, className }: ExecutionResultCardProps) {
  const { status, message, contentSegments, error, title } = result
  const isLoading = status === 'running'
  const isError = status === 'failed'
  const hasStructuredContent = contentSegments && contentSegments.length > 0
  const displayContent = isError ? error : message
  const { copied, copy } = useCopy({ toastMessage: 'Result copied to clipboard' })

  return (
    <div className={cn('relative group/result', className)}>
      <div className='relative rounded-2xl border bg-background group-hover/result:shadow-md transition-shadow duration-200'>
        {/* Header with title and status */}
        <div className='flex items-center justify-between border-b border-border px-4 py-2'>
          <span className='text-sm font-medium text-muted-foreground'>{title}</span>
          <StatusBadge status={status} />
        </div>

        {/* Content */}
        <div className='space-y-3 p-4'>
          {isLoading ? (
            <div className='flex items-center gap-2 text-muted-foreground'>
              <Loader2 className='size-4 animate-spin' />
              <span>Generating response...</span>
            </div>
          ) : isError ? (
            <div className='prose prose-sm dark:prose-invert max-w-none text-destructive'>
              <p className='whitespace-pre-wrap'>{error}</p>
            </div>
          ) : hasStructuredContent ? (
            // Rich content with file rendering
            <div className='prose prose-sm dark:prose-invert max-w-none'>
              <ContentSegmentRenderer segments={contentSegments} />
            </div>
          ) : displayContent ? (
            // Fallback to plain message
            <div className='prose prose-sm dark:prose-invert max-w-none'>
              <p className='whitespace-pre-wrap'>{displayContent}</p>
            </div>
          ) : (
            <div className='text-muted-foreground'>No output</div>
          )}
        </div>
      </div>

      {/* Action bar - show for both plain text and structured content */}
      {(displayContent || hasStructuredContent) && !isLoading && (
        <div className='relative mt-1 h-4 px-4 text-xs text-muted-foreground opacity-0 group-hover/result:opacity-100 transition-opacity duration-200'>
          <div className='absolute bottom-1 right-2 flex items-center'>
            <div className='ml-1 flex items-center gap-0.5 rounded-[10px] border border-border bg-background p-0.5 shadow-md backdrop-blur-sm'>
              <Button
                variant='ghost'
                size='icon'
                className='size-5'
                onClick={() => {
                  const copyText = hasStructuredContent
                    ? segmentsToMarkdown(contentSegments!)
                    : displayContent!
                  copy(copyText)
                }}>
                {copied ? <Check className='size-3!' /> : <Copy className='size-3!' />}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
