// apps/web/src/components/workflow/nodes/core/find/trace-renderer.tsx

'use client'

import { toRecordId } from '@auxx/lib/resources/client'
import { EntityListBlock } from '~/components/kopilot/ui/blocks/entity-list-block'
import { ThreadListBlock } from '~/components/kopilot/ui/blocks/thread-list-block'
import { TraceRawJson } from '~/components/workflow/panels/run/components/trace-render-boundary'
import type { TraceRendererProps } from '~/components/workflow/types/registry'

interface FindQueryInfo {
  resource_type?: string
  find_mode?: string
  total_conditions?: number
  limit_applied?: number
}

/**
 * Preview for Find node executions — result records as a hydrated entity list
 * (threads get the thread list treatment). The records array sits under a
 * dynamic key (the resource's lowercased plural name), so locate it by finding
 * the array-valued output key.
 */
export function FindTraceRenderer({ execution }: TraceRendererProps) {
  const outputs = (execution.outputs ?? {}) as Record<string, unknown>
  const queryInfo = (outputs.query_info ?? {}) as FindQueryInfo
  const resourceType = queryInfo.resource_type

  if (!resourceType) {
    return <TraceRawJson value={execution.outputs} />
  }

  // Records live under the resource's plural name — findOne returns a single
  // object, find returns an array. Normalize to an array of rows with ids.
  const recordsValue = Object.entries(outputs).find(
    ([key, value]) =>
      key !== 'query_info' && (Array.isArray(value) || (typeof value === 'object' && value))
  )?.[1]
  const records = (Array.isArray(recordsValue) ? recordsValue : [recordsValue]).filter(
    (r): r is { id: string } =>
      !!r && typeof r === 'object' && typeof (r as { id?: unknown }).id === 'string'
  )

  const count = typeof outputs.count === 'number' ? outputs.count : records.length
  const summaryParts = [
    `${count} result${count === 1 ? '' : 's'}`,
    queryInfo.total_conditions ? `${queryInfo.total_conditions} condition(s)` : null,
    queryInfo.find_mode === 'findOne' ? 'find one' : null,
  ].filter(Boolean)

  return (
    <div>
      <div className='px-1 pb-1 text-xs text-muted-foreground'>{summaryParts.join(' · ')}</div>
      {records.length === 0 ? (
        <div className='p-2 text-sm text-muted-foreground'>No records found</div>
      ) : resourceType === 'thread' ? (
        <ThreadListBlock data={{ threadIds: records.map((r) => r.id) }} skipEntrance />
      ) : (
        <EntityListBlock
          data={{ recordIds: records.map((r) => toRecordId(resourceType, r.id)) }}
          skipEntrance
        />
      )}
    </div>
  )
}
