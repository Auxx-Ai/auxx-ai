// apps/web/src/components/workflow/nodes/core/crud/trace-renderer.tsx

'use client'

import { toRecordId } from '@auxx/lib/resources/client'
import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { Badge } from '@auxx/ui/components/badge'
import { AlertCircle, Database } from 'lucide-react'
import { BlockCard } from '~/components/kopilot/ui/blocks/block-card'
import { EntityCardItem } from '~/components/kopilot/ui/blocks/entity-card-item'
import { TraceRawJson } from '~/components/workflow/panels/run/components/trace-render-boundary'
import type { TraceRendererProps } from '~/components/workflow/types/registry'

interface CrudOutputs {
  id?: string
  deleted?: boolean
  success?: boolean
  error?: string
}

const OPERATION_BADGES: Record<string, { label: string; variant: 'green' | 'blue' | 'red' }> = {
  create: { label: 'Created', variant: 'green' },
  update: { label: 'Updated', variant: 'blue' },
  delete: { label: 'Deleted', variant: 'red' },
}

/**
 * Preview for CRUD node executions — the affected record as a live-hydrated
 * entity card with an operation badge. resourceType/operation come from
 * executionMetadata, not outputs.
 */
export function CrudTraceRenderer({ execution }: TraceRendererProps) {
  const outputs = (execution.outputs ?? {}) as CrudOutputs
  const metadata = (execution.executionMetadata ?? {}) as {
    operation?: string
    resourceType?: string
  }

  // Error-continue output — the node was configured to continue on failure
  if (outputs.success === false) {
    return (
      <Alert variant='destructive'>
        <AlertCircle />
        <AlertTitle>Operation failed</AlertTitle>
        <AlertDescription>{outputs.error || 'The record operation failed.'}</AlertDescription>
      </Alert>
    )
  }

  const operation = metadata.operation
  const badge = operation ? OPERATION_BADGES[operation] : undefined

  if (!outputs.id || !metadata.resourceType) {
    return <TraceRawJson value={execution.outputs} />
  }

  return (
    <BlockCard
      data-slot='crud-trace-renderer'
      indicator={<Database className='size-3 text-muted-foreground' />}
      primaryText={metadata.resourceType}
      secondaryText={badge && <Badge variant={badge.variant}>{badge.label}</Badge>}
      hasFooter={false}>
      {outputs.deleted || operation === 'delete' ? (
        <div className='flex items-center gap-2 p-2 text-sm text-muted-foreground'>
          <span>Record deleted</span>
          <span className='truncate font-mono text-[10px] opacity-70'>{outputs.id}</span>
        </div>
      ) : (
        <EntityCardItem recordId={toRecordId(metadata.resourceType, outputs.id)} />
      )}
    </BlockCard>
  )
}
