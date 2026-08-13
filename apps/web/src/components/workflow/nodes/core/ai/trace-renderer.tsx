// apps/web/src/components/workflow/nodes/core/ai/trace-renderer.tsx

'use client'

import { Sparkles, TriangleAlert } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import { BlockCard } from '~/components/kopilot/ui/blocks/block-card'
import { CollapsedJson, FieldRows } from '~/components/workflow/nodes/shared/trace-primitives'
import { TraceRawJson } from '~/components/workflow/panels/run/components/trace-render-boundary'
import type { TraceRendererProps } from '~/components/workflow/types/registry'

interface AiOutputs {
  text?: string
  structured_output?: unknown
  tool_results?: Array<Record<string, unknown>>
  /** Capability-gate / structured-output-pass warnings surfaced by the engine. */
  _warnings?: string[]
}

/** Amber warning lines for skipped features / failed structured-output pass. */
function TraceWarnings({ warnings }: { warnings: string[] }) {
  return (
    <div className='space-y-1'>
      {warnings.map((warning) => (
        <div
          key={warning}
          className='flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400'>
          <TriangleAlert className='mt-0.5 size-3 shrink-0' />
          <span>{warning}</span>
        </div>
      ))}
    </div>
  )
}

/** Render structured output: flat object → field rows, anything else → collapsed JSON. */
function StructuredOutput({ value }: { value: unknown }) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return <FieldRows values={value as Record<string, unknown>} />
  }
  return <CollapsedJson title='Structured output' value={value} />
}

/**
 * Preview for AI node executions. In structured-output mode `outputs.text` is
 * itself the JSON string of `outputs.structured_output`, so we render the
 * structured output ONCE (readable field rows) and suppress the duplicate text.
 * Plain-text runs render `outputs.text` as markdown.
 */
export function AiTraceRenderer({ execution }: TraceRendererProps) {
  const outputs = (execution.outputs ?? {}) as AiOutputs
  const warnings = outputs._warnings ?? []
  const hasStructured =
    outputs.structured_output !== undefined && outputs.structured_output !== null

  if (!outputs.text && !hasStructured && warnings.length === 0) {
    return <TraceRawJson value={execution.outputs} />
  }

  return (
    <BlockCard
      data-slot='ai-trace-renderer'
      indicator={<Sparkles className='size-3 text-muted-foreground' />}
      primaryText={hasStructured ? 'Structured Output' : 'Generated Text'}
      hasFooter={false}>
      <div className='space-y-2 p-1'>
        {warnings.length > 0 && <TraceWarnings warnings={warnings} />}
        {hasStructured ? (
          <StructuredOutput value={outputs.structured_output} />
        ) : (
          outputs.text && (
            <div className='prose prose-sm dark:prose-invert max-w-none text-sm'>
              {/* remarkBreaks: single newlines are soft breaks in markdown and
                  would collapse to spaces — see the End trace renderer. */}
              <Markdown remarkPlugins={[remarkGfm, remarkBreaks]}>{outputs.text}</Markdown>
            </div>
          )
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
