// packages/lib/src/events/handlers/handle-record-rules.ts
// Dispatch door 2: record lifecycle. Bus consumer for `<prefix>:created` /
// `<prefix>:deleted` events — fires RecordRules with fieldId = null
// (`on: created|deleted`). Field-transition rules dispatch inline from the
// field-change hook seam instead (record-rules/hook-handler.ts).

import { createScopedLogger } from '@auxx/logger'
import { parseRecordId } from '@auxx/types/resource'
import type { AuxxEvent } from '../types'
import { getEventRecordId, getResourceTriggerMatch } from './trigger-resource-workflows'

const logger = createScopedLogger('record-rules-lifecycle')

export const handleRecordRules = async ({ data: event }: { data: AuxxEvent }) => {
  try {
    const match = getResourceTriggerMatch(event)
    if (!match || match.triggerType === 'updated') return

    const organizationId = event.data.organizationId
    if (!organizationId) return

    const { getCachedRecordRules, getCachedEntityDefId } = await import('../../cache')

    // Legacy-shape events carry an entityType ('ticket'/'contact') where modern
    // events carry the real definition id — normalize via the entityDefs cache.
    const entityDefinitionId =
      (await getCachedEntityDefId(organizationId, match.entityDefinitionId)) ??
      match.entityDefinitionId

    const on = match.triggerType === 'created' ? 'created' : 'deleted'
    const rules = (await getCachedRecordRules(organizationId)).filter(
      (rule) =>
        rule.enabled &&
        rule.fieldId === null &&
        rule.on === on &&
        rule.entityDefinitionId === entityDefinitionId
    )
    if (rules.length === 0) return

    const recordId = getEventRecordId(event, match)
    if (!recordId) return
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

    const { fireRecordRules } = await import('../../record-rules/engine')
    await fireRecordRules(rules, {
      organizationId,
      entityDefinitionId,
      entityInstanceId,
      source: 'interactive',
      userId: typeof payload.userId === 'string' ? payload.userId : undefined,
      snapshot,
    })
  } catch (error) {
    logger.error('Record-rule lifecycle dispatch failed', {
      eventType: event.type,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
