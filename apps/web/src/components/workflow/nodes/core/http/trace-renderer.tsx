// apps/web/src/components/workflow/nodes/core/http/trace-renderer.tsx

'use client'

import { Badge, type Variant } from '@auxx/ui/components/badge'
import { ChevronRight, Globe } from 'lucide-react'
import { BlockCard } from '~/components/kopilot/ui/blocks/block-card'
import { TraceRawJson } from '~/components/workflow/panels/run/components/trace-render-boundary'
import type { TraceRendererProps } from '~/components/workflow/types/registry'

interface HttpOutputs {
  status?: number
  statusText?: string
  headers?: Record<string, string>
  success?: boolean
  body?: unknown
  /** Present when error_strategy is 'none' — request failed but node continued. */
  error?: string
}

interface HttpInputs {
  url?: string
  method?: string
}

/** Collapsed JSON details section used for the response body. */
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

/** Status class → badge color: 2xx green, 3xx blue, 4xx amber, 5xx/network red. */
function statusVariant(status?: number): Variant {
  if (status == null) return 'gray'
  if (status >= 200 && status < 300) return 'green'
  if (status >= 300 && status < 400) return 'blue'
  if (status >= 400 && status < 500) return 'amber'
  if (status >= 500) return 'red'
  return 'gray'
}

/**
 * Preview for HTTP node executions — method + URL (from `execution.inputs`,
 * populated from the preprocessor's interpolated request, not `outputs`),
 * a status pill colored by response class, and the response body as
 * collapsed JSON.
 */
export function HttpTraceRenderer({ execution }: TraceRendererProps) {
  const outputs = (execution.outputs ?? {}) as HttpOutputs
  const inputs = (execution.inputs ?? {}) as HttpInputs

  if (outputs.status === undefined && !outputs.error) {
    return <TraceRawJson value={execution.outputs} />
  }

  const statusLabel = [outputs.status, outputs.statusText].filter(Boolean).join(' ')

  return (
    <BlockCard
      data-slot='http-trace-renderer'
      indicator={<Globe className='size-3 text-muted-foreground' />}
      primaryText={[inputs.method, inputs.url].filter(Boolean).join(' ') || 'HTTP Request'}
      secondaryText={
        <Badge variant={statusVariant(outputs.status)}>
          {statusLabel || outputs.error || 'Failed'}
        </Badge>
      }
      hasFooter={false}>
      <div className='space-y-2 p-1'>
        {outputs.error && <div className='text-xs text-destructive'>{outputs.error}</div>}
        {outputs.body !== undefined && <CollapsedJson title='Response body' value={outputs.body} />}
      </div>
    </BlockCard>
  )
}
