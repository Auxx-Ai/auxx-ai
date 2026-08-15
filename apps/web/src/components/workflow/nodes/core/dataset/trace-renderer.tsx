// apps/web/src/components/workflow/nodes/core/dataset/trace-renderer.tsx

'use client'

import type { Variant } from '@auxx/ui/components/badge'
import { Badge } from '@auxx/ui/components/badge'
import { Database } from 'lucide-react'
import { TraceRawJson } from '~/components/workflow/panels/run/components/trace-render-boundary'
import type { TraceRendererProps } from '~/components/workflow/types/registry'

/** Outputs as `DatasetProcessor.storeOutputVariables` writes them. */
interface DatasetOutputs {
  documentId?: string
  segmentIds?: string[]
  chunksAdded?: number
  embeddingStatus?: string
  datasetId?: string
  success?: boolean
  error?: string
  // Only written when the node waited for embeddings (embedding-wait.ts).
  segmentsEmbedded?: number
  processingTimeMs?: number
  completedAt?: string
}

/**
 * `embeddingStatus` is the one output that decides whether a later
 * knowledge-retrieval node in the same run can see this document, so it gets
 * the colour rather than `success` — a node can succeed with `queued` or
 * `timeout` and still leave the dataset without vectors.
 */
const STATUS_VARIANT: Record<string, Variant> = {
  completed: 'green',
  queued: 'blue',
  processing: 'blue',
  skipped: 'gray',
  timeout: 'amber',
  failed: 'red',
}

/**
 * Preview for Dataset executions.
 *
 * Without this the run panel shows no Preview tab at all and the author reads a
 * flat JSON blob whose only interesting field — did the embeddings actually
 * land — sits between a document id and an id array.
 */
export function DatasetTraceRenderer({ execution }: TraceRendererProps) {
  const outputs = (execution.outputs ?? {}) as DatasetOutputs

  // Unrecognised shape (e.g. a legacy execution) degrades to JSON rather than
  // throwing inside TraceRenderBoundary, which would read as "no preview".
  if (outputs.success === undefined && outputs.embeddingStatus === undefined) {
    return <TraceRawJson value={execution.outputs} />
  }

  const status = outputs.embeddingStatus
  const segmentCount = Array.isArray(outputs.segmentIds) ? outputs.segmentIds.length : undefined
  const chunksAdded = outputs.chunksAdded ?? segmentCount

  const summary = [
    typeof chunksAdded === 'number'
      ? `${chunksAdded.toLocaleString()} chunk${chunksAdded === 1 ? '' : 's'} added`
      : null,
    typeof outputs.segmentsEmbedded === 'number'
      ? `${outputs.segmentsEmbedded.toLocaleString()} embedded`
      : null,
    typeof outputs.processingTimeMs === 'number' ? `${outputs.processingTimeMs}ms` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div data-slot='dataset-trace-renderer'>
      <div className='rounded-xl bg-background p-2 ring-1 ring-border'>
        <div className='flex items-center gap-1.5'>
          <Database className='size-3 shrink-0 text-muted-foreground' />
          <span className='truncate text-xs font-medium'>
            {outputs.documentId ? `Document ${outputs.documentId}` : 'Document'}
          </span>
          {status && (
            <Badge variant={STATUS_VARIANT[status] ?? 'gray'} className='ml-auto shrink-0'>
              {status}
            </Badge>
          )}
        </div>

        {summary && <div className='mt-0.5 text-[11px] text-muted-foreground'>{summary}</div>}

        {outputs.datasetId && (
          <div className='mt-0.5 truncate text-[11px] text-muted-foreground'>
            Dataset {outputs.datasetId}
          </div>
        )}
      </div>

      {status === 'queued' && (
        <div className='mt-2 px-1 text-[11px] text-muted-foreground'>
          Embeddings are still generating — a knowledge-retrieval node later in this run may not see
          this document yet.
        </div>
      )}

      {outputs.success === false && outputs.error && (
        <div className='mt-2 px-1 text-xs text-destructive'>{outputs.error}</div>
      )}
    </div>
  )
}
