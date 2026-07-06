// packages/lib/src/events/handlers/trigger-resource-dispatch.ts

import type { RecordId } from '@auxx/types/resource'
import { fetchResourceById } from '../../resources/resource-fetcher'
import type { AuxxEvent } from '../types'
import { dispatchAgentTriggers } from './trigger-agents'
import { dispatchResourceWorkflows, type ResourceFetcher } from './trigger-resource-workflows'

/**
 * Combined CRUD-event dispatcher: runs the workflow and agent dispatchers in
 * one job with a memoized `fetchResourceById`, so an event that matches both
 * a workflow and an agent trigger resolves the record (multi-join + field
 * values) once instead of twice. The fetch stays lazy — each dispatcher
 * early-exits on no-match before touching it.
 *
 * Replaces the separate `triggerResourceWorkflows` + `triggerAgents` job
 * pairs in the `EventHandlers` map; the standalone handlers remain registered
 * for events that only need one of them (and for in-flight jobs).
 */
export const triggerResourceDispatch = async ({ data: event }: { data: AuxxEvent }) => {
  const memo = new Map<string, Promise<any | null>>()
  const fetchResource: ResourceFetcher = (recordId: RecordId, organizationId: string) => {
    const key = `${organizationId}:${recordId}`
    let pending = memo.get(key)
    if (!pending) {
      pending = fetchResourceById(recordId, organizationId)
      memo.set(key, pending)
    }
    return pending
  }

  await dispatchResourceWorkflows(event, fetchResource)
  await dispatchAgentTriggers(event, fetchResource)
}
