// apps/web/src/components/workflow/nodes/core/information-extractor/trace-renderer.tsx

'use client'

import { ChevronRight, ScanSearch } from 'lucide-react'
import { BlockCard } from '~/components/kopilot/ui/blocks/block-card'
import { TraceRawJson } from '~/components/workflow/panels/run/components/trace-render-boundary'
import type { TraceRendererProps } from '~/components/workflow/types/registry'

/** camelCase / snake_case → "Title Case" for extracted field keys */
function formatFieldKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase())
}

/**
 * Preview for Information Extractor node executions — the extracted object
 * IS `execution.outputs` itself (top-level keys are the extracted fields, not
 * nested under `structured_output`). Scalars render as label/value rows;
 * nested objects/arrays render as collapsed JSON. Not entity-backed, so
 * `kopilot-field-row` (which requires an entityDefinitionId) doesn't apply.
 */
export function InformationExtractorTraceRenderer({ execution }: TraceRendererProps) {
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
      data-slot='information-extractor-trace-renderer'
      indicator={<ScanSearch className='size-3 text-muted-foreground' />}
      primaryText='Extracted Data'
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
