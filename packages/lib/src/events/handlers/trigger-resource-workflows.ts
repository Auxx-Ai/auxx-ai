// packages/lib/src/events/handlers/trigger-resource-workflows.ts

import { createScopedLogger } from '@auxx/logger'
import { type RecordId, toRecordId } from '@auxx/types/resource'
import { canonicalizeEntityDefinitionId, getCachedWorkflowAppsByTrigger } from '../../cache'
import { getQueue } from '../../jobs/queues'
import { Queues } from '../../jobs/queues/types'
import { fetchResourceById, getRecordIdField } from '../../resources/resource-fetcher'
import type { AuxxEvent } from '../types'

const logger = createScopedLogger('trigger-resource-workflows')

export type ResourceTriggerType = 'created' | 'updated' | 'deleted'

export type ResourceTriggerMatch = {
  triggerType: ResourceTriggerType
  /**
   * The canonical form — the org's EntityDefinition id where one exists. Use it
   * for work that needs a single answer (RecordIds, record-rule dispatch).
   * Do NOT filter stored trigger rows with it; use {@link matchIds}.
   */
  entityDefinitionId: string
  /**
   * Every form a stored trigger row may legitimately hold for this entity:
   * the canonical id AND the bare entityType slug. Both are in production —
   * the resource picker writes `resource.entityDefinitionId || resourceType`,
   * which is the CUID for some paths and the slug for others, and a workflow
   * saved either way must keep firing. Filter with `matchIds.includes(...)`.
   */
  matchIds: readonly string[]
}

/** What the event alone can say, before the org's definition ids are known. */
export type RawResourceTriggerMatch = Pick<
  ResourceTriggerMatch,
  'triggerType' | 'entityDefinitionId'
>

/**
 * Resolve which resource CRUD trigger this event maps to. Shared with the
 * agent-trigger dispatcher (see `./trigger-agents.ts`).
 *
 * Prefer {@link resolveResourceTriggerMatch} — this reports the legacy family
 * under its slug, which is only one of the two forms stored triggers use.
 *
 * Modern-shape events (emitted from unified-handler-mutations) carry
 * `entityDefinitionId` directly in the payload — including custom-entity
 * cuids. Legacy-shape events (ticket/contact emitters) don't carry it,
 * so the entity is derived from the event-type prefix.
 *
 * Returns null when the event is not a resource CRUD trigger.
 */
export function getResourceTriggerMatch(event: AuxxEvent): RawResourceTriggerMatch | null {
  const payload = event.data as Record<string, unknown>
  const payloadEntityDefinitionId =
    typeof payload.entityDefinitionId === 'string' ? payload.entityDefinitionId : undefined

  switch (event.type) {
    // Modern shape — entityDefinitionId on payload
    case 'entity:created':
    case 'company:created':
    case 'stock_movement:created':
    case 'vendor_part:created':
    case 'subpart:created':
      return payloadEntityDefinitionId
        ? { triggerType: 'created', entityDefinitionId: payloadEntityDefinitionId }
        : null
    case 'entity:updated':
      return payloadEntityDefinitionId
        ? { triggerType: 'updated', entityDefinitionId: payloadEntityDefinitionId }
        : null
    case 'entity:deleted':
    case 'company:deleted':
    case 'stock_movement:deleted':
    case 'vendor_part:deleted':
    case 'subpart:deleted':
      return payloadEntityDefinitionId
        ? { triggerType: 'deleted', entityDefinitionId: payloadEntityDefinitionId }
        : null

    // Legacy shape — entity comes from event-type prefix
    case 'ticket:created':
      return { triggerType: 'created', entityDefinitionId: 'ticket' }
    case 'ticket:updated':
      return { triggerType: 'updated', entityDefinitionId: 'ticket' }
    case 'ticket:deleted':
      return { triggerType: 'deleted', entityDefinitionId: 'ticket' }
    case 'contact:created':
      return { triggerType: 'created', entityDefinitionId: 'contact' }
    case 'contact:updated':
      return { triggerType: 'updated', entityDefinitionId: 'contact' }
    case 'contact:deleted':
      return { triggerType: 'deleted', entityDefinitionId: 'contact' }

    default:
      return null
  }
}

/**
 * Resolve an event to its resource-trigger criteria **in the keyspace triggers
 * are actually stored in** — the org's EntityDefinition id.
 *
 * `getResourceTriggerMatch` reports the legacy `ticket:*`/`contact:*` family
 * under its slug, because those are the only events whose payload omits
 * `entityDefinitionId` (`publishEvent`'s perspective branch in
 * `resources/crud/unified-handler-mutations.ts`). Every writer stores the CUID —
 * the resource picker via `toCustomResourceBase`, agent triggers, and
 * `toRecordId(entityDef.id, …)` — and every consumer compares with strict
 * equality, so an unnormalized slug matches nothing and the trigger silently
 * never fires.
 *
 * `canonicalizeEntityDefinitionId` carries the tier gate — it deliberately
 * leaves `thread`/`article` alone; see its docblock.
 *
 * Both forms are returned, and **filtering must use `matchIds`, not
 * `entityDefinitionId`**: the column holds the CUID on some rows and the slug on
 * others (the picker writes `resource.entityDefinitionId || resourceType`), and
 * normalizing only the event side turns a working slug-keyed trigger into a
 * dead one. Canonicalizing on save fixes a row the next time it is saved; it
 * cannot fix the rows already out there.
 *
 * The value written as an execution-context key must come from the matched
 * workflow's OWN stored id, not from here — that is what its graph declared its
 * `{{node.<id>.field}}` paths against.
 */
export async function resolveResourceTriggerMatch(
  event: AuxxEvent,
  organizationId: string
): Promise<ResourceTriggerMatch | null> {
  const raw = getResourceTriggerMatch(event)
  if (!raw) return null
  const canonical = await canonicalizeEntityDefinitionId(organizationId, raw.entityDefinitionId)
  return {
    triggerType: raw.triggerType,
    entityDefinitionId: canonical,
    matchIds:
      canonical === raw.entityDefinitionId ? [canonical] : [canonical, raw.entityDefinitionId],
  }
}

/**
 * Resolve the RecordId for the event's subject resource.
 *
 * Modern-shape events already carry `recordId`. Legacy events don't —
 * construct it from the per-event id field (`ticketId`, `contactId`) and
 * the matched entityDefinitionId.
 */
export function getEventRecordId(event: AuxxEvent, match: ResourceTriggerMatch): RecordId | null {
  const payload = event.data as Record<string, unknown>

  if (typeof payload.recordId === 'string' && payload.recordId.includes(':')) {
    return payload.recordId as RecordId
  }

  const idField = getRecordIdField(event.type)
  if (!idField) return null
  const instanceId = payload[idField]
  if (typeof instanceId !== 'string' || !instanceId) return null
  return toRecordId(match.entityDefinitionId, instanceId)
}

/** Fetches the full resolved record for an event's subject resource. */
export type ResourceFetcher = (recordId: RecordId, organizationId: string) => Promise<any | null>

/**
 * One published workflow a resource event's trigger matches — everything the
 * enqueue needs, resolved once at match time so match-only consumers (the
 * Phase 6 sync dispatch guard's tally) and the enqueue path cannot drift.
 */
export interface WorkflowTriggerTarget {
  workflowAppId: string
  workflowId: string
  /** The workflow app's display name — for the tally / approval surfaces. */
  workflowName?: string
  triggerType: ResourceTriggerType
  /**
   * The id the `executeResourceTrigger` job payload carries: the workflow's
   * OWN stored id, not the event's — the job keys the trigger's output under
   * this (`resource-trigger-job.ts`), and the graph declared its
   * `{{node.<id>.field}}` paths against whatever the row holds. Sending the
   * canonical id to a slug-keyed workflow would fire it with unresolvable
   * variables.
   */
  jobEntityDefinitionId: string
}

/** What {@link matchResourceWorkflowTargets} resolved for one event. */
export interface ResourceWorkflowMatchResult {
  match: ResourceTriggerMatch
  targets: WorkflowTriggerTarget[]
}

/**
 * Match-only half of the dispatch: resolve which published workflows this
 * event's trigger matches — no record fetch, no enqueue. The Phase 6 guarded
 * dispatcher tallies large sync runs through this (plan events/03 §9, D-3);
 * {@link dispatchResourceWorkflows} composes it with the fetch + enqueue.
 *
 * Returns null when the event carries no org or maps to no resource trigger;
 * an empty `targets` array when the trigger matches no enabled workflow.
 */
export async function matchResourceWorkflowTargets(
  event: AuxxEvent
): Promise<ResourceWorkflowMatchResult | null> {
  // A handful of payloads (`integration:connection_failed`) fire before a
  // session is resolved and carry no org id. None of them map to a resource
  // trigger, so this is unreachable today — but workflow lookup is org-scoped
  // and must never run unscoped, and the entity normalization below is
  // per-org, so the check comes first.
  const organizationId = event.data.organizationId
  if (!organizationId) {
    logger.debug('Event has no organizationId; skipping workflow dispatch', {
      eventType: event.type,
    })
    return null
  }

  // 1. Map event to workflow trigger criteria — see `resolveResourceTriggerMatch`.
  const match = await resolveResourceTriggerMatch(event, organizationId)
  if (!match) {
    logger.debug('No workflow trigger mapping for event', { eventType: event.type })
    return null
  }

  // 2. Query workflows via org cache. Match on EVERY form the column may hold —
  //    a workflow saved with the bare slug must keep firing (see `matchIds`).
  const matchingApps = await getCachedWorkflowAppsByTrigger({
    organizationId,
    triggerType: match.triggerType,
    entityDefinitionIds: match.matchIds,
  })

  const targets: WorkflowTriggerTarget[] = []
  for (const app of matchingApps) {
    if (!app.publishedWorkflow) continue
    targets.push({
      workflowAppId: app.id,
      workflowId: app.publishedWorkflow.id,
      workflowName: app.name,
      triggerType: match.triggerType,
      jobEntityDefinitionId: app.publishedWorkflow.entityDefinitionId ?? match.entityDefinitionId,
    })
  }

  if (targets.length === 0) {
    logger.debug('No enabled workflows found', {
      triggerType: match.triggerType,
      entityDefinitionId: match.entityDefinitionId,
    })
  }
  return { match, targets }
}

/**
 * Enqueue half of the dispatch: one `executeResourceTrigger` job per target.
 * THE single enqueue seam — the per-event dispatcher, the guard's auto-dispatch
 * and an approved `bulk-dispatch` resolution all pass through here, so the job
 * payload cannot fork per producer.
 */
export async function enqueueWorkflowTriggerJobs(args: {
  organizationId: string
  targets: readonly WorkflowTriggerTarget[]
  resourceData: unknown
}): Promise<void> {
  const workflowDelayQueue = getQueue(Queues.workflowDelayQueue)
  for (const target of args.targets) {
    await workflowDelayQueue.add('executeResourceTrigger', {
      workflowAppId: target.workflowAppId,
      workflowId: target.workflowId,
      organizationId: args.organizationId,
      // The workflow's OWN stored id, not the event's — see
      // `WorkflowTriggerTarget.jobEntityDefinitionId`.
      entityDefinitionId: target.jobEntityDefinitionId,
      resourceData: args.resourceData,
      triggerType: target.triggerType,
      triggeredAt: new Date().toISOString(),
    })
  }
}

/**
 * Event handler that triggers workflows when resource events occur.
 * Fetches matching workflows and queues execution jobs.
 */
export const triggerResourceWorkflows = async ({ data: event }: { data: AuxxEvent }) =>
  dispatchResourceWorkflows(event, fetchResourceById)

/**
 * Core workflow dispatch with an injectable record fetcher so the combined
 * CRUD dispatcher (`trigger-resource-dispatch.ts`) can share one
 * `fetchResourceById` result with the agent dispatcher.
 */
export const dispatchResourceWorkflows = async (
  event: AuxxEvent,
  fetchResource: ResourceFetcher
) => {
  // 1+2. Match — org check, trigger criteria, workflow lookup (match-only half).
  const matched = await matchResourceWorkflowTargets(event)
  if (!matched || matched.targets.length === 0) return
  const { match, targets } = matched
  const { triggerType, entityDefinitionId } = match

  // 3. Fetch complete resource data
  const recordId = getEventRecordId(event, match)
  if (!recordId) {
    logger.error('Could not resolve recordId for event', {
      eventType: event.type,
      entityDefinitionId,
    })
    return
  }

  const resourceData = await fetchResource(recordId, event.data.organizationId as string)
  if (!resourceData) {
    logger.warn('Resource not found, skipping workflows', {
      recordId,
      eventType: event.type,
    })
    return
  }

  // 4. Enqueue jobs
  await enqueueWorkflowTriggerJobs({
    organizationId: event.data.organizationId as string,
    targets,
    resourceData,
  })

  logger.info('Queued workflows for resource trigger', {
    eventType: event.type,
    workflowCount: targets.length,
    triggerType,
    entityDefinitionId,
    recordId,
  })
}
