// packages/lib/src/field-hooks/collect-triggers.ts

import type { SystemAttribute } from '@auxx/types/system-attribute'
import { isSystemAttribute } from '@auxx/types/system-attribute'
import { getAllCachedCustomFields, getCachedRecordRules } from '../cache'
import { hasNativeAction } from '../record-rules/types'

export interface TriggeredField {
  fieldId: string
  systemAttribute: SystemAttribute
}

/**
 * Given a list of fieldIds that were mutated, return the ones that carry a NATIVE
 * (server-declared) record rule — i.e. the migrated manufacturing triggers (B2 §8). Uses
 * org cache only (no DB calls). Non-native user rules are dispatched separately by the
 * field-change hook (door 1), so they are intentionally excluded here.
 *
 * Returns the triggered systemAttributes with their fieldIds.
 */
export async function collectTriggeredFields(
  organizationId: string,
  fieldIds: string[],
  opts: {
    /**
     * The fields are being written as part of their record's CREATION. Rules
     * declared `skipOnCreate` are left to the def's lifecycle `created` rule.
     */
    isCreate?: boolean
  } = {}
): Promise<TriggeredField[]> {
  if (fieldIds.length === 0) return []

  const [allFields, rules] = await Promise.all([
    getAllCachedCustomFields(organizationId),
    getCachedRecordRules(organizationId),
  ])

  // Field row ids that have at least one enabled native rule.
  const nativeFieldIds = new Set<string>()
  for (const rule of rules) {
    if (!rule.enabled || rule.fieldId === null) continue
    if (opts.isCreate && rule.skipOnCreate) continue
    if (hasNativeAction(rule.actions)) nativeFieldIds.add(rule.fieldId)
  }
  if (nativeFieldIds.size === 0) return []

  const fieldMap = new Map(allFields.map((f) => [f.id, f]))

  const results: TriggeredField[] = []
  for (const fieldId of fieldIds) {
    if (!nativeFieldIds.has(fieldId)) continue
    const field = fieldMap.get(fieldId)
    if (!field?.systemAttribute) continue
    if (!isSystemAttribute(field.systemAttribute)) continue
    results.push({ fieldId, systemAttribute: field.systemAttribute })
  }

  return results
}

/**
 * Deduplicate triggered fields by systemAttribute.
 * When the same systemAttribute appears multiple times (e.g., bulk operations),
 * only keep one entry per unique systemAttribute.
 */
export function deduplicateBySystemAttribute(fields: TriggeredField[]): TriggeredField[] {
  const seen = new Set<SystemAttribute>()
  return fields.filter((f) => {
    if (seen.has(f.systemAttribute)) return false
    seen.add(f.systemAttribute)
    return true
  })
}
