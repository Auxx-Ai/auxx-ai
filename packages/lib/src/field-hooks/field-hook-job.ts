// packages/lib/src/field-hooks/field-hook-job.ts

import { createScopedLogger } from '@auxx/logger'
import { parseRecordId, type RecordId } from '@auxx/types/resource'
import type { FieldTriggerJobEvent } from '../events/types'
import { hasNativeAction } from '../record-rules/types'

const logger = createScopedLogger('field-hooks')

/**
 * Interactive field-trigger dispatch has no captured old/new values — the legacy
 * FIELD_TRIGGERS registry (removed in B2 §8) fired UNCONDITIONALLY on any write of the
 * field, and this door inherits that contract (the sync-manifest consumer is the path that
 * has real old→new values and matches `changed` precisely). To fire the all-native system
 * rules through the engine's `changed`-transition matcher without real values, each event
 * presents this sentinel as the new value against an `undefined` old value — guaranteed
 * unequal, so the transition always matches. Native handlers ignore the event values
 * entirely; only the diagnostic `RecordRuleRun` row records the sentinel.
 */
export const INTERACTIVE_FIELD_WRITE = { interactiveFieldWrite: true } as const

/**
 * Handler for `field:trigger` events (dispatched inline from the interactive write paths;
 * see `field-hooks/publish.ts`). Resolves the org's cached record rules for the changed
 * systemAttribute's field and fires their NATIVE actions once per record batch via the
 * engine's `fireRecordRulesBatch` (source `'interactive'`). Non-native (user) rules are NOT
 * fired here — they dispatch from the field-change hook (door 1) with real old/new values.
 */
export async function handleFieldTriggerJob({
  data,
}: {
  data: FieldTriggerJobEvent
}): Promise<void> {
  const { systemAttribute, recordIds, organizationId, userId } = data.data
  if (recordIds.length === 0) return

  try {
    const { getCachedRecordRules, getAllCachedCustomFields } = await import('../cache')
    const [rules, allFields] = await Promise.all([
      getCachedRecordRules(organizationId),
      getAllCachedCustomFields(organizationId),
    ])

    // Group record ids by their entity def. A systemAttribute belongs to one def, but stay
    // robust to a mixed batch (bulk paths pass every changed record for each attribute).
    const instancesByDef = new Map<string, string[]>()
    for (const rid of recordIds as RecordId[]) {
      const { entityDefinitionId, entityInstanceId } = parseRecordId(rid)
      const arr = instancesByDef.get(entityDefinitionId)
      if (arr) arr.push(entityInstanceId)
      else instancesByDef.set(entityDefinitionId, [entityInstanceId])
    }

    const { fireRecordRulesBatch } = await import('../record-rules/engine')

    let firedDefs = 0
    for (const [entityDefinitionId, instanceIds] of instancesByDef) {
      const field = allFields.find(
        (f) => f.entityDefinitionId === entityDefinitionId && f.systemAttribute === systemAttribute
      )
      if (!field) continue

      // Only native (system) rules on this field — user rules already fire via door 1.
      const nativeRules = rules.filter(
        (r) => r.enabled && r.fieldId === field.id && hasNativeAction(r.actions)
      )
      if (nativeRules.length === 0) continue

      await fireRecordRulesBatch(nativeRules, {
        organizationId,
        entityDefinitionId,
        source: 'interactive',
        userId,
        events: instanceIds.map((entityInstanceId) => ({
          entityInstanceId,
          fieldId: field.id,
          oldValue: undefined,
          newValue: INTERACTIVE_FIELD_WRITE,
        })),
      })
      firedDefs++
    }

    if (firedDefs > 0) {
      logger.debug(`Processed field trigger: ${systemAttribute}`, {
        recordCount: recordIds.length,
        firedDefs,
      })
    }
  } catch (error) {
    logger.error(`Field trigger dispatch failed for ${systemAttribute}`, {
      recordIds,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
