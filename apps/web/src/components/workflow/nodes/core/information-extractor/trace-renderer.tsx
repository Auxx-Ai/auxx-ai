// apps/web/src/components/workflow/nodes/core/information-extractor/trace-renderer.tsx

'use client'

import { ScanSearch } from 'lucide-react'
import { BlockCard } from '~/components/kopilot/ui/blocks/block-card'
import { FieldRows } from '~/components/workflow/nodes/shared/trace-primitives'
import { TraceRawJson } from '~/components/workflow/panels/run/components/trace-render-boundary'
import type { TraceRendererProps } from '~/components/workflow/types/registry'

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

  const values = outputs as Record<string, unknown>
  if (Object.keys(values).length === 0) {
    return <TraceRawJson value={outputs} />
  }

  return (
    <BlockCard
      data-slot='information-extractor-trace-renderer'
      indicator={<ScanSearch className='size-3 text-muted-foreground' />}
      primaryText='Extracted Data'
      hasFooter={false}>
      <div className='p-1'>
        <FieldRows values={values} />
      </div>
    </BlockCard>
  )
}
