// apps/web/src/components/data-connectors/ui/connector-backfill-progress.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { LastUpdated } from '@auxx/ui/components/last-updated'
import { cn } from '@auxx/ui/lib/utils'
import { CheckCircle2 } from 'lucide-react'

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
  /**
   * Trial-sync §5.2 — set ⇒ this run is a SAMPLE: the card reads "Sampling — N of
   * {sampleLimit} per stream" and each stream shows its progress toward the cap,
   * since a sample HAS a known denominator (unlike a full backfill).
   */
  sampleLimit?: number | null
  /**
   * Render the settled, post-sync state: no more candy-stripe motion, a "Synced"
   * header with a check, and the freshness time in the footer instead of "Started".
   * Lets the per-stream breakdown LINGER after a run finishes rather than vanishing
   * the instant the connector flips `syncing → live`.
   */
  completed?: boolean
  /** Freshness time shown in the completed footer (lastSyncedAt). */
  syncedAt?: Date | string | null
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
  sampleLimit,
  completed = false,
  syncedAt,
}: ConnectorBackfillProgressProps) {
  const total = perStream.reduce((n, s) => n + s.recordsSeen, 0)
  const isSample = sampleLimit != null

  const header = completed
    ? `Synced from ${sourceLabel}`
    : isSample
      ? `Sampling from ${sourceLabel}`
      : `Importing from ${sourceLabel}`

  return (
    <div className='flex flex-col gap-3 border-b bg-muted/30 px-4 py-3'>
      <div className='flex items-center gap-1.5 text-xs font-semibold text-muted-foreground'>
        {completed && <CheckCircle2 className='size-3.5 text-info' />}
        {header}
      </div>

      <div className='flex flex-col gap-2'>
        {perStream.map((s) => (
          <StreamRow
            key={s.streamKey || '∅'}
            stream={s}
            sampleLimit={sampleLimit}
            done={completed}
          />
        ))}
      </div>

      <div className='text-[11px] text-muted-foreground'>
        {completed ? (
          <>
            {`${total.toLocaleString()} records synced`}
            {syncedAt && (
              <>
                {' · '}
                <LastUpdated timestamp={syncedAt} className='text-[11px]' />
              </>
            )}
          </>
        ) : (
          <>
            {startedAt && (
              <>
                <LastUpdated timestamp={startedAt} prefix='Started' className='text-[11px]' />
                {' · '}
              </>
            )}
            {isSample
              ? `Sampling up to ${sampleLimit?.toLocaleString()} per stream`
              : `${total.toLocaleString()} records so far`}
          </>
        )}
      </div>
    </div>
  )
}

/** A stream's row: name, an activity bar (state color, not %), count, and status word. */
function StreamRow({
  stream,
  sampleLimit,
  done: forceDone = false,
}: {
  stream: BackfillStreamProgress
  sampleLimit?: number | null
  /** Force the settled (solid, "done") look — the card-level completed state. */
  done?: boolean
}) {
  // A sample HAS a denominator (the cap), so show "N of limit" + a real fill ratio —
  // the one place a backfill bar isn't faking a percent (full backfills never know total).
  const capped = sampleLimit != null && stream.recordsSeen >= sampleLimit
  const done = forceDone || stream.done || capped
  const fillPct =
    sampleLimit != null ? Math.min(100, Math.round((stream.recordsSeen / sampleLimit) * 100)) : null
  return (
    <div className='flex items-center gap-2 text-xs'>
      <span className='w-24 shrink-0 truncate capitalize' title={stream.streamKey}>
        {stream.streamKey || 'Records'}
      </span>
      <div className='h-1.5 flex-1 overflow-hidden rounded-full bg-primary-500'>
        <div
          className={cn(
            'h-full rounded-full bg-info',
            !done && 'candy-stripes',
            fillPct == null && 'w-full'
          )}
          style={fillPct != null ? { width: `${fillPct}%` } : undefined}
        />
      </div>
      <span className='w-20 shrink-0 text-right tabular-nums text-muted-foreground'>
        {sampleLimit != null
          ? `${stream.recordsSeen.toLocaleString()} / ${sampleLimit.toLocaleString()}`
          : stream.recordsSeen.toLocaleString()}
      </span>
      <div className='flex w-16 shrink-0 justify-end'>
        <Badge size='xs' variant={done ? 'green' : 'amber'}>
          {done ? 'done' : 'fetching…'}
        </Badge>
      </div>
    </div>
  )
}
