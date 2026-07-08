// apps/web/src/components/workflow/nodes/core/var-assign/trace-renderer.tsx

'use client'

import { Braces } from 'lucide-react'
import { BlockCard } from '~/components/kopilot/ui/blocks/block-card'
import { FieldRows } from '~/components/workflow/nodes/shared/trace-primitives'
import { TraceRawJson } from '~/components/workflow/panels/run/components/trace-render-boundary'
import type { TraceRendererProps } from '~/components/workflow/types/registry'

interface VarAssignOutputs {
  variables?: Record<string, unknown>
  count?: number
}

/**
 * Preview for Set Variables node executions — the assigned variables as
 * label/value rows (`outputs.variables`).
 */
export function VarAssignTraceRenderer({ execution }: TraceRendererProps) {
  const o = (execution.outputs ?? {}) as VarAssignOutputs
  const variables = o.variables

  if (!variables || typeof variables !== 'object' || Array.isArray(variables)) {
    return <TraceRawJson value={execution.outputs} />
  }

  const count = o.count ?? Object.keys(variables).length

  return (
    <BlockCard
      data-slot='var-assign-trace-renderer'
      indicator={<Braces className='size-3 text-muted-foreground' />}
      primaryText='Set Variables'
      secondaryText={`${count} variable${count === 1 ? '' : 's'}`}
      hasFooter={false}>
      <div className='p-1'>
        <FieldRows values={variables} />
      </div>
    </BlockCard>
  )
}
