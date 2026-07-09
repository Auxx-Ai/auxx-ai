// apps/web/src/components/workflow/nodes/core/format/trace-renderer.tsx

'use client'

import { CaseSensitive } from 'lucide-react'
import { BlockCard } from '~/components/kopilot/ui/blocks/block-card'
import { TraceRawJson } from '~/components/workflow/panels/run/components/trace-render-boundary'
import type { TraceRendererProps } from '~/components/workflow/types/registry'

interface FormatOutputs {
  result?: string | string[]
}

/**
 * Preview for Format node executions — the formatted `result`. A string renders
 * inline (whitespace preserved); a string[] (e.g. split) renders as chips.
 */
export function FormatTraceRenderer({ execution }: TraceRendererProps) {
  const o = (execution.outputs ?? {}) as FormatOutputs
  const { result } = o

  if (result === undefined || result === null) {
    return <TraceRawJson value={execution.outputs} />
  }

  return (
    <BlockCard
      data-slot='format-trace-renderer'
      indicator={<CaseSensitive className='size-3 text-muted-foreground' />}
      primaryText='Format'
      hasFooter={false}>
      <div className='p-1 text-sm'>
        {Array.isArray(result) ? (
          <div className='flex flex-wrap gap-1'>
            {result.map((item, i) => (
              <span
                key={i}
                className='max-w-[220px] truncate rounded-full bg-background px-2 py-0.5 text-xs ring-1 ring-border'>
                {String(item)}
              </span>
            ))}
          </div>
        ) : (
          <span className='font-medium whitespace-pre-wrap break-words'>{String(result)}</span>
        )}
      </div>
    </BlockCard>
  )
}
