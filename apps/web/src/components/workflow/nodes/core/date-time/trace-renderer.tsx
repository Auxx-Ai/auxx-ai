// apps/web/src/components/workflow/nodes/core/date-time/trace-renderer.tsx

'use client'

import { CalendarClock } from 'lucide-react'
import { BlockCard } from '~/components/kopilot/ui/blocks/block-card'
import { formatDateValue } from '~/components/workflow/nodes/shared/trace-primitives'
import { TraceRawJson } from '~/components/workflow/panels/run/components/trace-render-boundary'
import type { TraceRendererProps } from '~/components/workflow/types/registry'

interface DateTimeOutputs {
  result?: unknown
  operation?: string
  inputDate?: unknown
  outputFormat?: string
}

/**
 * Preview for Date / Time node executions — an "input → result" transform line
 * plus the operation and output format.
 */
export function DateTimeTraceRenderer({ execution }: TraceRendererProps) {
  const o = (execution.outputs ?? {}) as DateTimeOutputs

  if (o.result === undefined) {
    return <TraceRawJson value={execution.outputs} />
  }

  const hasInput = o.inputDate !== undefined && o.inputDate !== null

  return (
    <BlockCard
      data-slot='date-time-trace-renderer'
      indicator={<CalendarClock className='size-3 text-muted-foreground' />}
      primaryText='Date / Time'
      secondaryText={o.operation}
      hasFooter={false}>
      <div className='space-y-1 p-1 text-sm'>
        <div className='flex flex-wrap items-center gap-1.5'>
          {hasInput && (
            <>
              <span className='text-neutral-400'>{formatDateValue(o.inputDate)}</span>
              <span className='text-neutral-400'>→</span>
            </>
          )}
          <span className='font-medium'>{formatDateValue(o.result)}</span>
        </div>
        {o.outputFormat && <div className='text-xs text-neutral-400'>Format: {o.outputFormat}</div>}
      </div>
    </BlockCard>
  )
}
