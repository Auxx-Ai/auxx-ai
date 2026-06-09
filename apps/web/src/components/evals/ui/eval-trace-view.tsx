// apps/web/src/components/evals/ui/eval-trace-view.tsx
'use client'

import type { EvalTraceEvent } from '@auxx/types/evals'
import { EmptySection } from '@auxx/ui/components/section'
import { Activity } from 'lucide-react'
import { EvalTraceEventCard } from './eval-trace-event-card'

/**
 * The chronological trace of an agent simulation run — a stacked list of
 * {@link EvalTraceEventCard}s in sequence order. Live (via the run store) or
 * replayed from the persisted row; the view itself is a pure render of whatever
 * events it's handed.
 */

interface EvalTraceViewProps {
  trace: EvalTraceEvent[]
  /** True while the run is still streaming — shows a trailing pulse. */
  isLive?: boolean
}

export function EvalTraceView({ trace, isLive }: EvalTraceViewProps) {
  if (trace.length === 0) {
    return (
      <EmptySection
        icon={<Activity className='size-4' />}
        title={isLive ? 'Waiting for events…' : 'No trace'}
        description={
          isLive
            ? 'The run is starting up. Events will appear here as they happen.'
            : 'This run recorded no trace events.'
        }
        loading={isLive}
      />
    )
  }

  const ordered = [...trace].sort((a, b) => a.sequence - b.sequence)

  return (
    <div className='space-y-1.5'>
      {ordered.map((event) => (
        <EvalTraceEventCard key={event.id} event={event} />
      ))}
      {isLive ? (
        <div className='flex items-center gap-2 px-2.5 py-1.5 text-xs text-muted-foreground'>
          <span className='inline-block size-2 animate-pulse rounded-full bg-blue-500' />
          Running…
        </div>
      ) : null}
    </div>
  )
}
