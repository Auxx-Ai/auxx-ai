// packages/lib/src/field-triggers/collect-triggers.ts

import type { SystemAttribute } from '@auxx/types/system-attribute'
import { isSystemAttribute } from '@auxx/types/system-attribute'
import { getAllCachedCustomFields } from '../cache'
import { hasFieldTriggers } from './registry'

export interface TriggeredField {
  fieldId: string
  systemAttribute: SystemAttribute
}

/**
 * Given a list of fieldIds that were mutated, check which ones have
 * systemAttributes with registered triggers. Uses org cache only (no DB calls).
 *
 * Returns the list of triggered systemAttributes with their fieldIds.
 */
export async function collectTriggeredFields(
  organizationId: string,
  fieldIds: string[]
): Promise<TriggeredField[]> {
  if (fieldIds.length === 0) return []

  const allFields = await getAllCachedCustomFields(organizationId)
  const fieldMap = new Map(allFields.map((f) => [f.id, f]))

  const results: TriggeredField[] = []
  for (let i = 0; i < fieldIds.length; i++) {
    const field = fieldMap.get(fieldIds[i]!)
    if (!field?.systemAttribute) continue
    if (!isSystemAttribute(field.systemAttribute)) continue
    if (!hasFieldTriggers(field.systemAttribute)) continue
    results.push({ fieldId: fieldIds[i]!, systemAttribute: field.systemAttribute })
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
