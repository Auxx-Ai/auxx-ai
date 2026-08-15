// apps/web/src/components/workflow/nodes/core/chunker/trace-renderer.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { TraceRawJson } from '~/components/workflow/panels/run/components/trace-render-boundary'
import type { TraceRendererProps } from '~/components/workflow/types/registry'

/** One chunk, as `ChunkerProcessor` writes it (a `DocumentChunk`). */
interface Chunk {
  content?: string
  position?: number
  tokenCount?: number
  wordCount?: number
}

interface ChunkerMetadata {
  totalCharacters?: number
  totalTokens?: number
  averageChunkSize?: number
  minChunkSize?: number
  maxChunkSize?: number
  originalLength?: number
}

interface ChunkerOutputs {
  chunks?: Chunk[]
  chunkCount?: number
  metadata?: ChunkerMetadata
  success?: boolean
  error?: string
}

/**
 * Display-only clamps. The persisted output keeps every chunk at full length —
 * a downstream Dataset node writes them verbatim into the vector store, so
 * truncating the stored value would corrupt the ingest. These only shorten what
 * we paint.
 */
const SNIPPET_CHARS = 160
const MAX_ROWS = 20

function snippet(content: string | undefined): string {
  if (!content) return ''
  const flat = content.replace(/\s+/g, ' ').trim()
  return flat.length > SNIPPET_CHARS ? `${flat.slice(0, SNIPPET_CHARS)}…` : flat
}

/**
 * Preview for Chunker executions.
 *
 * Without this the run panel shows no Preview tab at all and the author reads
 * the entire chunk array — every passage, at full length — as JSON in a 300px
 * `<pre>`. The one thing they need (*did it split where I expected, and how
 * big are the pieces*) is exactly what scrolling hides.
 */
export function ChunkerTraceRenderer({ execution }: TraceRendererProps) {
  const outputs = (execution.outputs ?? {}) as ChunkerOutputs

  // Unrecognised shape (e.g. a legacy execution) degrades to JSON rather than
  // throwing inside TraceRenderBoundary, which would read as "no preview".
  if (!Array.isArray(outputs.chunks) && outputs.success === undefined) {
    return <TraceRawJson value={execution.outputs} />
  }

  const chunks = Array.isArray(outputs.chunks) ? outputs.chunks : []
  const count = typeof outputs.chunkCount === 'number' ? outputs.chunkCount : chunks.length
  const metadata = outputs.metadata ?? {}

  const summary = [
    `${count} chunk${count === 1 ? '' : 's'}`,
    typeof metadata.averageChunkSize === 'number'
      ? `avg ${Math.round(metadata.averageChunkSize).toLocaleString()} chars`
      : null,
    typeof metadata.minChunkSize === 'number' && typeof metadata.maxChunkSize === 'number'
      ? `${metadata.minChunkSize.toLocaleString()}–${metadata.maxChunkSize.toLocaleString()}`
      : null,
    typeof metadata.totalTokens === 'number'
      ? `~${metadata.totalTokens.toLocaleString()} tokens`
      : null,
  ]
    .filter(Boolean)
    .join(' · ')

  const shown = chunks.slice(0, MAX_ROWS)

  return (
    <div data-slot='chunker-trace-renderer'>
      <div className='px-1 pb-1 text-xs text-muted-foreground'>{summary}</div>

      {outputs.success === false && outputs.error && (
        <div className='mb-2 px-1 text-xs text-destructive'>{outputs.error}</div>
      )}

      {chunks.length === 0 ? (
        <div className='p-2 text-sm text-muted-foreground'>No chunks produced</div>
      ) : (
        <div className='space-y-1'>
          {shown.map((chunk, index) => (
            <div
              key={chunk.position ?? index}
              className='rounded-xl bg-background p-2 ring-1 ring-border'>
              <div className='flex items-center gap-1.5'>
                <span className='text-xs font-medium'>#{(chunk.position ?? index) + 1}</span>
                {typeof chunk.content === 'string' && (
                  <span className='text-[11px] text-muted-foreground'>
                    {chunk.content.length.toLocaleString()} chars
                  </span>
                )}
                {typeof chunk.tokenCount === 'number' && (
                  <Badge variant='gray' className='ml-auto shrink-0'>
                    ~{chunk.tokenCount.toLocaleString()} tok
                  </Badge>
                )}
              </div>
              {chunk.content && (
                <p className='mt-1 text-xs text-muted-foreground'>{snippet(chunk.content)}</p>
              )}
            </div>
          ))}

          {chunks.length > shown.length && (
            <div className='px-1 pt-1 text-[11px] text-muted-foreground'>
              +{chunks.length - shown.length} more in the Outputs tab
            </div>
          )}
        </div>
      )}
    </div>
  )
}
