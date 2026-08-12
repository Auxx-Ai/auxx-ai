// apps/web/src/components/workflow/nodes/core/wait/trace-renderer.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Timer } from 'lucide-react'
import { BlockCard } from '~/components/kopilot/ui/blocks/block-card'
import { formatDateValue, humanizeMs } from '~/components/workflow/nodes/shared/trace-primitives'
import { TraceRawJson } from '~/components/workflow/panels/run/components/trace-render-boundary'
import type { TraceRendererProps } from '~/components/workflow/types/registry'

interface WaitOutputs {
  wait_duration_ms?: number
  /** `short_delay` (setTimeout) or `queue_delay` (the node paused onto the delay queue). */
  wait_method?: string
  dryRun?: boolean
  paused_at?: string
  resume_at?: string
}

/**
 * Preview for Wait node executions — a completed short delay shows "Waited …";
 * a queued/paused long delay shows the duration and resume time. Dry runs get
 * an amber badge.
 */
export function WaitTraceRenderer({ execution }: TraceRendererProps) {
  const o = (execution.outputs ?? {}) as WaitOutputs

  if (o.wait_duration_ms === undefined && !o.resume_at) {
    return <TraceRawJson value={execution.outputs} />
  }

  const duration = o.wait_duration_ms !== undefined ? humanizeMs(o.wait_duration_ms) : null
  // Both paths now report `resume_at`, so the method is what distinguishes a queued wait
  // (still pending) from a completed setTimeout one.
  const isQueued = o.wait_method === 'queue_delay'

  return (
    <BlockCard
      data-slot='wait-trace-renderer'
      indicator={<Timer className='size-3 text-muted-foreground' />}
      primaryText='Wait'
      secondaryText={o.dryRun ? <Badge variant='amber'>Dry run</Badge> : undefined}
      hasFooter={false}>
      <div className='flex flex-wrap items-center gap-1.5 p-1 text-sm'>
        {isQueued ? (
          <>
            <span className='font-medium'>Waiting {duration}</span>
            <span className='text-neutral-400'>· resumes {formatDateValue(o.resume_at)}</span>
          </>
        ) : (
          <>
            <span className='font-medium'>Waited {duration}</span>
            {o.wait_method && <span className='text-neutral-400'>· {o.wait_method}</span>}
          </>
        )}
      </div>
    </BlockCard>
  )
}
