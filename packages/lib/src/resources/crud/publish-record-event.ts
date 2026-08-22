// packages/lib/src/resources/crud/publish-record-event.ts

// The record lifecycle bus event, extracted from `unified-handler-mutations` so
// two producers can share ONE shaping function: the inline mutation path, and
// `tx-write-flush`'s post-commit replay of a buffered transaction write scope
// (plan 04 §6.5). The replayed event must be byte-identical to the inline one,
// which is exactly what a second copy of this logic would eventually stop being.
//
// Kept as a LEAF on purpose — `events/publisher` and `events/types` only — so
// the flush can import it without pulling `unified-handler-mutations` (and with
// it the org cache) into a composition site's static module graph.

import { publisher } from '../../events/publisher'
import type { Events } from '../../events/types'
import type { RecordId } from '../resource-id'

/**
 * Parameters for publishing entity events
 */
export interface PublishEventParams {
  recordId: RecordId
  entityType: string | null
  entityDefinitionId: string
  entitySlug: string
  action: 'created' | 'updated' | 'deleted'
  organizationId: string
  userId: string
  eventData: Record<string, unknown>
  relatedRecordId?: RecordId
}

/**
 * The `<entityType>:<action>` event types that actually exist on the bus, split by payload shape.
 *
 * Composing the type from `entityDef.entityType` unchecked is not safe: most built-in resources
 * (`part`, `quote`, `invoice`, `work_order`, `service_request`, …) have no per-type event and no
 * entry in `EventHandlers`, so `publishEventJob` would find zero handlers and drop the event —
 * no timeline entry, no record rules, no dispatch trigger. Anything not listed here falls back to
 * the generic `entity:*` family, which is what the fallback was always documented to do.
 */
const PERSPECTIVE_EVENT_TYPES = [
  'ticket:created',
  'ticket:updated',
  'ticket:deleted',
  'contact:created',
  'contact:updated',
  'contact:deleted',
] as const satisfies readonly Events[]

/**
 * The other half of the per-type events. Same trigger, different payload: these carry the
 * definition identity rather than a second perspective.
 */
const DEFINITION_EVENT_TYPES = [
  'company:created',
  'company:deleted',
  'stock_movement:created',
  'stock_movement:deleted',
  'vendor_part:created',
  'vendor_part:deleted',
  'subpart:created',
  'subpart:deleted',
] as const satisfies readonly Events[]

type PerspectiveEventType = (typeof PERSPECTIVE_EVENT_TYPES)[number]
type DefinitionEventType = (typeof DEFINITION_EVENT_TYPES)[number]

function isPerspectiveEventType(type: string): type is PerspectiveEventType {
  return (PERSPECTIVE_EVENT_TYPES as readonly string[]).includes(type)
}

function isDefinitionEventType(type: string): type is DefinitionEventType {
  return (DEFINITION_EVENT_TYPES as readonly string[]).includes(type)
}

/**
 * Publish entity event.
 * Uses entity-type-specific event type when one exists (e.g., 'ticket:created'),
 * falls back to generic 'entity:created' for everything else.
 *
 * @param params - Event parameters including recordId, eventData, etc.
 */
export function publishRecordLifecycleEvent(params: PublishEventParams): void {
  const {
    recordId,
    entityType,
    entityDefinitionId,
    entitySlug,
    action,
    organizationId,
    userId,
    eventData,
    relatedRecordId,
  } = params

  const specific = `${entityType}:${action}`
  const base = { recordId, organizationId, userId, eventData }

  // The ticket/contact family is the only one whose payload carries a second perspective
  // (the contact-side timeline row keys off `relatedRecordId`).
  if (isPerspectiveEventType(specific)) {
    publisher.publishLater({
      type: specific,
      data: { ...base, ...(relatedRecordId && { relatedRecordId }) },
    })
    return
  }

  publisher.publishLater({
    type: isDefinitionEventType(specific) ? specific : `entity:${action}`,
    data: { ...base, entityDefinitionId, entitySlug },
  })
}
