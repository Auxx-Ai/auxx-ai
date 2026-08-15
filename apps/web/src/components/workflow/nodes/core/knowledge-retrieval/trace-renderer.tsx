// apps/web/src/components/workflow/nodes/core/knowledge-retrieval/trace-renderer.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { BookOpen, Database } from 'lucide-react'
import Link from 'next/link'
import { TraceRawJson } from '~/components/workflow/panels/run/components/trace-render-boundary'
import type { TraceRendererProps } from '~/components/workflow/types/registry'

/** One flattened result, as `KnowledgeRetrievalProcessor` writes it. */
interface RetrievalResult {
  content?: string
  score?: number
  documentTitle?: string
  datasetName?: string
  segmentId?: string
  /** 'kb' for a knowledge-base article, 'rag' for an uploaded document (#1642). */
  source?: 'kb' | 'rag'
  articleId?: string
  kbId?: string
  docSlug?: string
}

interface RetrievalOutputs {
  results?: RetrievalResult[]
  total?: number
  responseTime?: number
  searchType?: string
  success?: boolean
  error?: string
}

/**
 * Display-only clamp. The persisted output keeps the FULL passage — a
 * downstream `ai`/`answer` node consumes it, so truncating the stored value
 * would silently degrade the reply (K11). This only shortens what we paint.
 */
const SNIPPET_CHARS = 220

function snippet(content: string | undefined): string {
  if (!content) return ''
  const flat = content.replace(/\s+/g, ' ').trim()
  return flat.length > SNIPPET_CHARS ? `${flat.slice(0, SNIPPET_CHARS)}…` : flat
}

/**
 * Preview for Knowledge Retrieval executions.
 *
 * Without this the run panel shows no Preview tab at all and the author reads a
 * wall of untruncated passages in a 300px `<pre>` — the one thing they need
 * (*did my query hit the right articles, at what score*) buried behind
 * scrolling.
 *
 * KB hits deep-link into the KB editor. `auxx://doc/<slug>` chips are NOT
 * available here — they only render inside assistant messages — so this uses a
 * normal route link, which needs `kbId` + `articleId` (both present on KB
 * results since #1642).
 */
export function KnowledgeRetrievalTraceRenderer({ execution }: TraceRendererProps) {
  const outputs = (execution.outputs ?? {}) as RetrievalOutputs

  // Unrecognised shape (e.g. a legacy execution) degrades to JSON rather than
  // throwing inside TraceRenderBoundary, which would read as "no preview".
  if (!Array.isArray(outputs.results) && outputs.success === undefined) {
    return <TraceRawJson value={execution.outputs} />
  }

  const results = Array.isArray(outputs.results) ? outputs.results : []
  const count = typeof outputs.total === 'number' ? outputs.total : results.length
  const summary = [
    `${count} result${count === 1 ? '' : 's'}`,
    outputs.searchType,
    typeof outputs.responseTime === 'number' ? `${outputs.responseTime}ms` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div data-slot='knowledge-retrieval-trace-renderer'>
      <div className='px-1 pb-1 text-xs text-muted-foreground'>{summary}</div>

      {outputs.success === false && outputs.error && (
        <div className='mb-2 px-1 text-xs text-destructive'>{outputs.error}</div>
      )}

      {results.length === 0 ? (
        <div className='p-2 text-sm text-muted-foreground'>No results</div>
      ) : (
        <div className='space-y-1'>
          {results.map((result, index) => {
            const isKb = result.source === 'kb'
            const title = result.documentTitle || 'Untitled'
            const href =
              isKb && result.kbId && result.articleId
                ? `/app/kb/${result.kbId}/editor/r/${result.articleId}`
                : undefined

            return (
              <div
                key={result.segmentId ?? index}
                className='rounded-xl bg-background p-2 ring-1 ring-border'>
                <div className='flex items-center gap-1.5'>
                  {isKb ? (
                    <BookOpen className='size-3 shrink-0 text-muted-foreground' />
                  ) : (
                    <Database className='size-3 shrink-0 text-muted-foreground' />
                  )}
                  {href ? (
                    <Link
                      href={href}
                      className='truncate text-xs font-medium hover:underline'
                      target='_blank'>
                      {title}
                    </Link>
                  ) : (
                    <span className='truncate text-xs font-medium'>{title}</span>
                  )}
                  {typeof result.score === 'number' && (
                    <Badge variant='gray' className='ml-auto shrink-0'>
                      {result.score.toFixed(2)}
                    </Badge>
                  )}
                </div>

                {result.datasetName && (
                  <div className='mt-0.5 truncate text-[11px] text-muted-foreground'>
                    {result.datasetName}
                  </div>
                )}

                {result.content && (
                  <p className='mt-1 text-xs text-muted-foreground'>{snippet(result.content)}</p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
