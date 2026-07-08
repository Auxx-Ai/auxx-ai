// apps/web/src/components/workflow/nodes/core/code/trace-renderer.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Code } from 'lucide-react'
import { BlockCard } from '~/components/kopilot/ui/blocks/block-card'
import { FieldRows } from '~/components/workflow/nodes/shared/trace-primitives'
import { TraceRawJson } from '~/components/workflow/panels/run/components/trace-render-boundary'
import type { TraceRendererProps } from '~/components/workflow/types/registry'

/** Base preprocess stores node config under `inputs.config`. */
interface CodeInputs {
  config?: { code_language?: string }
}

/**
 * Preview for Code node executions — the returned object as label/value rows
 * plus a language badge (from config). No source snippet.
 */
export function CodeTraceRenderer({ execution }: TraceRendererProps) {
  const outputs = execution.outputs
  const inputs = (execution.inputs ?? {}) as CodeInputs
  const language = inputs.config?.code_language

  if (!outputs || typeof outputs !== 'object' || Array.isArray(outputs)) {
    return <TraceRawJson value={outputs} />
  }

  const values = outputs as Record<string, unknown>
  if (Object.keys(values).length === 0) {
    return <TraceRawJson value={outputs} />
  }

  return (
    <BlockCard
      data-slot='code-trace-renderer'
      indicator={<Code className='size-3 text-muted-foreground' />}
      primaryText='Code'
      secondaryText={language ? <Badge variant='gray'>{language}</Badge> : undefined}
      hasFooter={false}>
      <div className='p-1'>
        <FieldRows values={values} />
      </div>
    </BlockCard>
  )
}
