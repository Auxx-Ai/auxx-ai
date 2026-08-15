// apps/web/src/components/workflow/nodes/core/document-extractor/trace-renderer.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { FileText, Link2 } from 'lucide-react'
import { TraceRawJson } from '~/components/workflow/panels/run/components/trace-render-boundary'
import type { TraceRendererProps } from '~/components/workflow/types/registry'

/** Metadata as `DocumentExtractorProcessor` writes it — file and URL runs differ. */
interface ExtractionMetadata {
  fileName?: string
  mimeType?: string
  fileSize?: number
  sourceUrl?: string
  contentLength?: number
  extractorUsed?: string
}

interface ExtractionOutputs {
  content?: string
  wordCount?: number
  metadata?: ExtractionMetadata
  success?: boolean
  error?: string
}

/**
 * Display-only clamp. The persisted output keeps the FULL text — a downstream
 * Chunker node consumes it, so truncating the stored value would silently
 * shorten every chunk. This only shortens what we paint.
 */
const PREVIEW_CHARS = 600

function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Preview for Document Extractor executions.
 *
 * Without this the run panel shows no Preview tab at all and the author reads
 * the whole extracted document as a JSON string in a 300px `<pre>` — with the
 * one thing they need (*did it read the right file, and did any text come out*)
 * buried behind escaped newlines.
 */
export function DocumentExtractorTraceRenderer({ execution }: TraceRendererProps) {
  const outputs = (execution.outputs ?? {}) as ExtractionOutputs

  // Unrecognised shape (e.g. a legacy execution) degrades to JSON rather than
  // throwing inside TraceRenderBoundary, which would read as "no preview".
  if (typeof outputs.content !== 'string' && outputs.success === undefined) {
    return <TraceRawJson value={execution.outputs} />
  }

  const metadata = outputs.metadata ?? {}
  const isUrl = !!metadata.sourceUrl
  const title = metadata.fileName || metadata.sourceUrl || 'Document'
  const content = typeof outputs.content === 'string' ? outputs.content : ''
  const size = metadata.fileSize ?? metadata.contentLength

  const summary = [
    typeof outputs.wordCount === 'number' ? `${outputs.wordCount.toLocaleString()} words` : null,
    `${content.length.toLocaleString()} chars`,
    typeof size === 'number' ? humanBytes(size) : null,
    metadata.mimeType,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div data-slot='document-extractor-trace-renderer'>
      <div className='rounded-xl bg-background p-2 ring-1 ring-border'>
        <div className='flex items-center gap-1.5'>
          {isUrl ? (
            <Link2 className='size-3 shrink-0 text-muted-foreground' />
          ) : (
            <FileText className='size-3 shrink-0 text-muted-foreground' />
          )}
          <span className='truncate text-xs font-medium'>{title}</span>
          {metadata.extractorUsed && (
            <Badge variant='gray' className='ml-auto shrink-0'>
              {metadata.extractorUsed}
            </Badge>
          )}
        </div>

        <div className='mt-0.5 text-[11px] text-muted-foreground'>{summary}</div>
      </div>

      {outputs.success === false && outputs.error && (
        <div className='mt-2 px-1 text-xs text-destructive'>{outputs.error}</div>
      )}

      {content ? (
        <p className='mt-2 px-1 text-xs whitespace-pre-wrap text-muted-foreground'>
          {content.length > PREVIEW_CHARS ? `${content.slice(0, PREVIEW_CHARS)}…` : content}
        </p>
      ) : (
        outputs.success !== false && (
          <div className='mt-2 p-2 text-sm text-muted-foreground'>No text extracted</div>
        )
      )}
    </div>
  )
}
