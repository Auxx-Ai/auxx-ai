// packages/lib/src/record-rules/hook-handler.ts
// Dispatch door 1: field transitions. Registered as a global '*' EntityFieldChangeHook
// (register-hooks.ts), so it runs inline after every interactive field write.
//
// IMPORTANT: this file is reachable from the field-hooks registry bootstrap — keep
// top-level imports to types/logger only and lazy-import everything else, or the
// registry ⇄ crud ⇄ field-values import cycle bites (and vi.mock breaks in tests).

import { createScopedLogger } from '@auxx/logger'
import { parseRecordId } from '@auxx/types/resource'
import type { EntityFieldChangeEvent } from '../field-hooks/types'

const logger = createScopedLogger('record-rules-hook')

/**
 * Match cached field rules against a field write and fire them. Errors are
 * swallowed — a rule must never break the originating write.
 */
export async function handleRecordRulesOnFieldChange(event: EntityFieldChangeEvent): Promise<void> {
  try {
    const { getCachedRecordRules } = await import('../cache')
    const rules = await getCachedRecordRules(event.organizationId)
    if (rules.length === 0) return

    // A rule's fieldId is normalized to the field row id at write time, but match
    // the systemAttribute too — refs resolve by either form.
    const candidates = rules.filter(
      (rule) =>
        rule.enabled &&
        rule.fieldId !== null &&
        (rule.fieldId === event.field.id ||
          (event.field.systemAttribute && rule.fieldId === event.field.systemAttribute))
    )
    if (candidates.length === 0) return

    const { matchesFieldTransition } = await import('./transitions')
    const matched = candidates.filter((rule) =>
      matchesFieldTransition(rule.on, event.oldValue, event.newValue)
    )
    if (matched.length === 0) return

    const { entityInstanceId } = parseRecordId(event.recordId)
    const { fireRecordRules } = await import('./engine')
    await fireRecordRules(matched, {
      organizationId: event.organizationId,
      entityDefinitionId: event.entityDefinitionId,
      entityInstanceId,
      source: 'interactive',
      userId: event.userId,
      fieldId: event.field.id,
      oldValue: event.oldValue,
      newValue: event.newValue,
    })
  } catch (error) {
    logger.error('Record-rule field dispatch failed', {
      organizationId: event.organizationId,
      fieldId: event.field?.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
