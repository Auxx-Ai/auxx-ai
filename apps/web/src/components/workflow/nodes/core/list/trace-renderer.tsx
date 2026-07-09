// apps/web/src/components/workflow/nodes/core/list/trace-renderer.tsx

'use client'

import { List } from 'lucide-react'
import { BlockCard } from '~/components/kopilot/ui/blocks/block-card'
import { isScalar, ValueCell } from '~/components/workflow/nodes/shared/trace-primitives'
import { TraceRawJson } from '~/components/workflow/panels/run/components/trace-render-boundary'
import type { TraceRendererProps } from '~/components/workflow/types/registry'

interface ListOutputs {
  result?: unknown
  operation?: string
  [key: string]: unknown
}

const MAX_ITEMS = 8

/**
 * Preview for List node executions — adaptive by result shape. Arrays render as
 * item chips with a count + operation summary (truncated past MAX_ITEMS); scalar
 * results (e.g. length, join, includes) render as a single value.
 */
export function ListTraceRenderer({ execution }: TraceRendererProps) {
  const o = (execution.outputs ?? {}) as ListOutputs

  if (!('result' in o)) {
    return <TraceRawJson value={execution.outputs} />
  }

  const { result, operation } = o

  if (Array.isArray(result)) {
    const shown = result.slice(0, MAX_ITEMS)
    const rest = result.length - shown.length
    const summary = [operation, `${result.length} item${result.length === 1 ? '' : 's'}`]
      .filter(Boolean)
      .join(' · ')

    return (
      <BlockCard
        data-slot='list-trace-renderer'
        indicator={<List className='size-3 text-muted-foreground' />}
        primaryText='List'
        secondaryText={summary}
        hasFooter={false}>
        <div className='flex flex-wrap gap-1 p-1'>
          {shown.map((item, i) => (
            <span
              key={i}
              className='max-w-[220px] truncate rounded-full bg-background px-2 py-0.5 text-xs ring-1 ring-border'>
              {isScalar(item) ? String(item ?? '∅') : JSON.stringify(item)}
            </span>
          ))}
          {rest > 0 && (
            <span className='rounded-full px-2 py-0.5 text-xs text-neutral-400'>+{rest} more</span>
          )}
        </div>
      </BlockCard>
    )
  }

  return (
    <BlockCard
      data-slot='list-trace-renderer'
      indicator={<List className='size-3 text-muted-foreground' />}
      primaryText='List'
      secondaryText={operation}
      hasFooter={false}>
      <div className='p-1 text-sm'>
        <ValueCell value={result} />
      </div>
    </BlockCard>
  )
}
