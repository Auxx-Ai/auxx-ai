// apps/web/src/components/workflow/nodes/shared/generic-app-trace-renderer.tsx

'use client'

import { Blocks, ChevronRight } from 'lucide-react'
import { BlockCard } from '~/components/kopilot/ui/blocks/block-card'
import { TraceRawJson } from '~/components/workflow/panels/run/components/trace-render-boundary'
import type { TraceRendererProps } from '~/components/workflow/types/registry'

/** camelCase / snake_case → "Title Case" for output keys */
function formatFieldKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase())
}

/**
 * Fallback preview for app-block executions (`appId:blockId` node types). App
 * outputs are un-schematized pass-through data, so this must tolerate anything:
 * top-level scalars render as label/value rows, objects and arrays nest as
 * collapsed JSON.
 */
export function GenericAppTraceRenderer({ execution }: TraceRendererProps) {
  const outputs = execution.outputs

  if (!outputs || typeof outputs !== 'object' || Array.isArray(outputs)) {
    return <TraceRawJson value={outputs} />
  }

  const entries = Object.entries(outputs as Record<string, unknown>)
  if (entries.length === 0) {
    return <TraceRawJson value={outputs} />
  }

  const isScalar = (value: unknown) =>
    value === null || ['string', 'number', 'boolean'].includes(typeof value)
  const scalars = entries.filter(([, value]) => value === undefined || isScalar(value))
  const complex = entries.filter(([, value]) => value !== undefined && !isScalar(value))

  return (
    <BlockCard
      data-slot='generic-app-trace-renderer'
      indicator={<Blocks className='size-3 text-muted-foreground' />}
      primaryText='Output'
      hasFooter={false}>
      <div className='space-y-1 p-1'>
        {scalars.map(([key, value]) => (
          <div key={key} className='flex min-h-[26px] w-full items-center gap-1 text-sm'>
            <div className='w-[120px] shrink-0 truncate text-neutral-400'>
              {formatFieldKey(key)}
            </div>
            <div className='min-w-0 flex-1 truncate font-medium'>{String(value ?? '')}</div>
          </div>
        ))}
        {complex.map(([key, value]) => (
          <details key={key} className='group rounded-xl bg-background ring-1 ring-border'>
            <summary className='flex cursor-pointer items-center gap-1 px-2 py-1.5 text-xs font-medium text-muted-foreground select-none'>
              <ChevronRight className='size-3 transition-transform group-open:rotate-90' />
              {formatFieldKey(key)}
            </summary>
            <pre className='max-h-[200px] overflow-auto p-2 pt-0 font-mono text-xs'>
              {JSON.stringify(value, null, 2)}
            </pre>
          </details>
        ))}
      </div>
    </BlockCard>
  )
}
