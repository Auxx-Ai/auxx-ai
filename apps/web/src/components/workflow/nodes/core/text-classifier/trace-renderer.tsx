// apps/web/src/components/workflow/nodes/core/text-classifier/trace-renderer.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Progress } from '@auxx/ui/components/progress'
import { Tag } from 'lucide-react'
import { BlockCard } from '~/components/kopilot/ui/blocks/block-card'
import { TraceRawJson } from '~/components/workflow/panels/run/components/trace-render-boundary'
import type { TraceRendererProps } from '~/components/workflow/types/registry'

interface TextClassifierOutputs {
  category?: string
  /** 0-1 float, clamped by parseClassificationResult */
  confidence?: number
  reasoning?: string
}

/**
 * Preview for Text Classifier node executions — the chosen category as a
 * badge, confidence as a small progress bar + percentage, and the model's
 * reasoning as muted supporting text.
 */
export function TextClassifierTraceRenderer({ execution }: TraceRendererProps) {
  const outputs = (execution.outputs ?? {}) as TextClassifierOutputs

  if (!outputs.category && typeof outputs.confidence !== 'number') {
    return <TraceRawJson value={execution.outputs} />
  }

  const pct =
    typeof outputs.confidence === 'number'
      ? Math.round(Math.max(0, Math.min(1, outputs.confidence)) * 100)
      : null

  return (
    <BlockCard
      data-slot='text-classifier-trace-renderer'
      indicator={<Tag className='size-3 text-muted-foreground' />}
      primaryText='Classification'
      hasFooter={false}>
      <div className='space-y-2 p-1'>
        <div className='flex items-center gap-2'>
          {outputs.category && <Badge variant='blue'>{outputs.category}</Badge>}
          {pct !== null && <span className='text-xs text-muted-foreground'>{pct}%</span>}
        </div>
        {pct !== null && <Progress value={pct} className='h-1.5' />}
        {outputs.reasoning && (
          <div className='text-xs text-muted-foreground'>{outputs.reasoning}</div>
        )}
      </div>
    </BlockCard>
  )
}
