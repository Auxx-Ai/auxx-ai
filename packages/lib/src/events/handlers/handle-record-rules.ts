// packages/lib/src/events/handlers/handle-record-rules.ts
// Dispatch door 2: record lifecycle. Bus consumer for `<prefix>:created` /
// `<prefix>:deleted` events — fires RecordRules with fieldId = null
// (`on: created|deleted`). Field-transition rules dispatch inline from the
// field-change hook seam instead (record-rules/hook-handler.ts).

import { createScopedLogger } from '@auxx/logger'
import { parseRecordId } from '@auxx/types/resource'
import type { AuxxEvent } from '../types'
import { getEventRecordId, resolveResourceTriggerMatch } from './trigger-resource-workflows'

const logger = createScopedLogger('record-rules-lifecycle')

export const handleRecordRules = async ({ data: event }: { data: AuxxEvent }) => {
  try {
    const organizationId = event.data.organizationId
    if (!organizationId) {
      logger.debug('Event has no organizationId — skipping', { eventType: event.type })
      return
    }

    // Legacy-shape events carry an entityType ('ticket'/'contact') where modern
    // events carry the real definition id; the shared resolver normalizes it.
    const match = await resolveResourceTriggerMatch(event, organizationId)
    if (!match || match.triggerType === 'updated') {
      if (!match) logger.debug('No resource trigger match — skipping', { eventType: event.type })
      return
    }
    // Canonical id for the work below; `matchIds` for filtering stored rows,
    // which may be keyed by either form.
    const { entityDefinitionId, matchIds } = match

    const { getCachedRecordRules } = await import('../../cache')

    const on = match.triggerType === 'created' ? 'created' : 'deleted'
    const allRules = await getCachedRecordRules(organizationId)
    const rules = allRules.filter(
      (rule) =>
        rule.enabled &&
        rule.fieldId === null &&
        rule.on === on &&
        matchIds.includes(rule.entityDefinitionId)
    )
    logger.debug('Lifecycle event matched against cached rules', {
      eventType: event.type,
      organizationId,
      entityDefinitionId,
      on,
      cachedRules: allRules.length,
      cachedSystemRules: allRules.filter((r) => r.isSystem).map((r) => r.id),
      matched: rules.map((r) => r.id),
    })
    if (rules.length === 0) return

    const recordId = getEventRecordId(event, match)
    if (!recordId) {
      logger.debug('Could not resolve recordId from event — skipping', { eventType: event.type })
      return
    }
    const { entityInstanceId } = parseRecordId(recordId)

    // Deleted records can't be fetched — evaluate conditions against the event's
    // last-known values payload.
    const payload = event.data as Record<string, unknown>
    const eventData =
      payload.eventData && typeof payload.eventData === 'object'
        ? (payload.eventData as Record<string, unknown>)
        : null
    const snapshot =
      on === 'deleted'
        ? { id: entityInstanceId, entityDefinitionId, fieldValues: eventData ?? {} }
        : undefined

    // Batch entry point so native lifecycle rules (migrated ENTITY_TRIGGERS — BOM cost /
    // stock explode+QoH / company enrich, B2 §9) get the raw create/delete-time `eventData`
    // this event already carries, without a DB refetch. Non-native user rules run per-record
    // with the snapshot exactly as before (batch-of-1 ≡ single).
    logger.debug('Dispatching lifecycle rules', {
      eventType: event.type,
      entityInstanceId,
      hasEventData: eventData !== null,
      eventDataKeys: eventData ? Object.keys(eventData) : [],
    })
    const { fireRecordRulesBatch } = await import('../../record-rules/engine')
    await fireRecordRulesBatch(rules, {
      organizationId,
      entityDefinitionId,
      source: 'interactive',
      userId: typeof payload.userId === 'string' ? payload.userId : undefined,
      events: [{ entityInstanceId, snapshot, eventData: eventData ?? undefined }],
    })
  } catch (error) {
    logger.error('Record-rule lifecycle dispatch failed', {
      eventType: event.type,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
