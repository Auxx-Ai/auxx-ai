// apps/web/src/components/workflow/nodes/core/ai/trace-renderer.tsx

'use client'

import { ChevronRight, Sparkles } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { BlockCard } from '~/components/kopilot/ui/blocks/block-card'
import { TraceRawJson } from '~/components/workflow/panels/run/components/trace-render-boundary'
import type { TraceRendererProps } from '~/components/workflow/types/registry'

interface AiOutputs {
  text?: string
  structured_output?: unknown
  tool_results?: Array<Record<string, unknown>>
}

/** Collapsed JSON details section used for structured output / tool results. */
function CollapsedJson({ title, value }: { title: string; value: unknown }) {
  return (
    <details className='group rounded-xl bg-background ring-1 ring-border'>
      <summary className='flex cursor-pointer items-center gap-1 px-2 py-1.5 text-xs font-medium text-muted-foreground select-none'>
        <ChevronRight className='size-3 transition-transform group-open:rotate-90' />
        {title}
      </summary>
      <pre className='max-h-[200px] overflow-auto p-2 pt-0 font-mono text-xs'>
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  )
}

/**
 * Preview for AI node executions — the generated text rendered as markdown,
 * with structured output and tool results as collapsed sections.
 */
export function AiTraceRenderer({ execution }: TraceRendererProps) {
  const outputs = (execution.outputs ?? {}) as AiOutputs

  if (!outputs.text && outputs.structured_output === undefined) {
    return <TraceRawJson value={execution.outputs} />
  }

  return (
    <BlockCard
      data-slot='ai-trace-renderer'
      indicator={<Sparkles className='size-3 text-muted-foreground' />}
      primaryText='Generated Text'
      hasFooter={false}>
      <div className='space-y-2 p-1'>
        {outputs.text && (
          <div className='prose prose-sm dark:prose-invert max-w-none text-sm'>
            <Markdown remarkPlugins={[remarkGfm]}>{outputs.text}</Markdown>
          </div>
        )}
        {outputs.structured_output !== undefined && outputs.structured_output !== null && (
          <CollapsedJson title='Structured output' value={outputs.structured_output} />
        )}
        {!!outputs.tool_results?.length && (
          <CollapsedJson
            title={`Tool results (${outputs.tool_results.length})`}
            value={outputs.tool_results}
          />
        )}
      </div>
    </BlockCard>
  )
}
