// apps/web/src/components/data-connectors/ui/connector-backfill-progress.tsx
'use client'

import { LastUpdated } from '@auxx/ui/components/last-updated'
import { cn } from '@auxx/ui/lib/utils'
import { ArrowRight } from 'lucide-react'

/** One stream's live import progress, projected from `getStatus.perStream`. */
export interface BackfillStreamProgress {
  streamKey: string
  recordsSeen: number
  phase: 'backfill' | 'steady'
  done: boolean
}

interface ConnectorBackfillProgressProps {
  /** The source being imported from (the connector name). */
  sourceLabel: string
  /** When the current backfill run started (latestRun.startedAt). */
  startedAt?: Date | string | null
  perStream: BackfillStreamProgress[]
}

/**
 * The initial-backfill progress card (Step 9 §10.2) — live per-stream counts + a
 * Fetch→Map→Save flow indicator, shown only while a backfill is in flight. Counts are
 * the real signal; bars encode STATE (working vs. done), never a percent-of-total —
 * upstream totals are unknown, so we never fake a denominator (§1). Mirrors Airbyte's
 * per-stream counts + Stitch's pipeline metaphor.
 */
export function ConnectorBackfillProgress({
  sourceLabel,
  startedAt,
  perStream,
}: ConnectorBackfillProgressProps) {
  const total = perStream.reduce((n, s) => n + s.recordsSeen, 0)

  return (
    <div className='flex flex-col gap-3 border-b bg-muted/30 px-4 py-3'>
      <div className='text-xs font-semibold text-muted-foreground'>
        Importing from {sourceLabel}
      </div>

      <div className='flex flex-col gap-2'>
        {perStream.map((s) => (
          <StreamRow key={s.streamKey || '∅'} stream={s} />
        ))}
      </div>

      <PipelineFlow />

      <div className='text-[11px] text-muted-foreground'>
        {startedAt && (
          <>
            <LastUpdated timestamp={startedAt} prefix='Started' className='text-[11px]' />
            {' · '}
          </>
        )}
        {total.toLocaleString()} records so far
      </div>
    </div>
  )
}

/** A stream's row: name, an activity bar (state color, not %), count, and status word. */
function StreamRow({ stream }: { stream: BackfillStreamProgress }) {
  return (
    <div className='flex items-center gap-2 text-xs'>
      <span className='w-24 shrink-0 truncate capitalize' title={stream.streamKey}>
        {stream.streamKey || 'Records'}
      </span>
      <div className='h-1.5 flex-1 overflow-hidden rounded-full bg-foreground/10'>
        <div
          className={cn(
            'h-full w-full rounded-full',
            stream.done ? 'bg-green-500/70' : 'animate-pulse bg-amber-500/70'
          )}
        />
      </div>
      <span className='w-20 shrink-0 text-right tabular-nums text-muted-foreground'>
        {stream.recordsSeen.toLocaleString()}
      </span>
      <span
        className={cn(
          'w-16 shrink-0 text-right',
          stream.done ? 'text-green-600' : 'text-amber-600'
        )}>
        {stream.done ? 'done' : 'fetching…'}
      </span>
    </div>
  )
}

/**
 * The Fetch → Map → Save flow metaphor (Stitch). Our engine streams records through
 * all three continuously, so during a backfill all three read as active — it conveys
 * "data is flowing", not staged percentages.
 */
function PipelineFlow() {
  return (
    <div className='flex items-center gap-1.5 text-[11px] text-muted-foreground'>
      {['Fetch', 'Map', 'Save'].map((label, i) => (
        <span key={label} className='inline-flex items-center gap-1.5'>
          {i > 0 && <ArrowRight className='size-3 opacity-50' />}
          <span className='inline-flex items-center gap-1'>
            <span className='size-1.5 animate-pulse rounded-full bg-amber-500' />
            {label}
          </span>
        </span>
      ))}
    </div>
  )
}
