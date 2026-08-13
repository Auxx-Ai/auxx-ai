// apps/web/src/components/workflow/nodes/core/end/trace-renderer.tsx

'use client'

import type { ContentSegment, WorkflowFileData } from '@auxx/lib/workflow-engine/client'
import { Badge } from '@auxx/ui/components/badge'
import { Flag, Paperclip } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import { BlockCard } from '~/components/kopilot/ui/blocks/block-card'
import { TraceRawJson } from '~/components/workflow/panels/run/components/trace-render-boundary'
import type { TraceRendererProps } from '~/components/workflow/types/registry'

interface EndOutputs {
  message?: string
  contentSegments?: ContentSegment[]
  status?: 'success' | 'error'
  completedAt?: string
}

/** Flatten file / file-array segments into a single file list for chips. */
function collectFiles(segments?: ContentSegment[]): WorkflowFileData[] {
  if (!segments) return []
  return segments.flatMap((segment) => {
    if (segment.type === 'file') return [segment.value]
    if (segment.type === 'file-array') return segment.value
    return []
  })
}

/**
 * Preview for End node executions — the completion message rendered as
 * markdown, with any file content segments shown as small chips.
 */
export function EndTraceRenderer({ execution }: TraceRendererProps) {
  const outputs = (execution.outputs ?? {}) as EndOutputs

  if (!outputs.message && !outputs.contentSegments?.length) {
    return <TraceRawJson value={execution.outputs} />
  }

  const files = collectFiles(outputs.contentSegments)
  const badge =
    outputs.status === 'error' ? (
      <Badge variant='red'>Error</Badge>
    ) : outputs.status === 'success' ? (
      <Badge variant='green'>Success</Badge>
    ) : null

  return (
    <BlockCard
      data-slot='end-trace-renderer'
      indicator={<Flag className='size-3 text-muted-foreground' />}
      primaryText='Output'
      secondaryText={badge}
      hasFooter={false}>
      <div className='space-y-2 p-1'>
        {/* `remarkBreaks` renders a single newline as a <br>. Without it the
            markdown soft break survives into the DOM as a literal "\n" that
            `white-space: normal` collapses to a space, so a multi-line
            completion message reads as one run-on line — while the same text in
            the Outputs tab (a <pre>) and in the share view
            (`whitespace-pre-wrap`) shows its line breaks. */}
        {outputs.message && (
          <div className='prose prose-sm dark:prose-invert max-w-none text-sm'>
            <Markdown remarkPlugins={[remarkGfm, remarkBreaks]}>{outputs.message}</Markdown>
          </div>
        )}
        {files.length > 0 && (
          <div className='flex flex-wrap gap-1'>
            {files.map((file) => (
              <a
                key={file.id}
                href={file.url}
                target='_blank'
                rel='noreferrer'
                className='inline-flex items-center gap-1 rounded-full bg-background px-2 py-1 text-xs ring-1 ring-border hover:bg-muted/50'>
                <Paperclip className='size-3' />
                <span className='max-w-[160px] truncate'>{file.filename}</span>
              </a>
            ))}
          </div>
        )}
      </div>
    </BlockCard>
  )
}
