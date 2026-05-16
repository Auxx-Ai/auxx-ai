// packages/lib/src/field-values/typed-column-match.ts

import type { TypedFieldValueInput } from '@auxx/types'
import { parseRecordId } from '../resources/resource-id'

/**
 * Single row's value payload column used for typed-equality dedup.
 * Shared by add/remove multi-value flows and by `lookupByField` reads —
 * any caller that needs "which column do I compare, and to what value"
 * for a given TypedFieldValueInput routes through here.
 */
export type TypedColumnMatch =
  | { column: 'valueText'; value: string }
  | { column: 'valueNumber'; value: number }
  | { column: 'valueBoolean'; value: boolean }
  | { column: 'valueDate'; value: string }
  | { column: 'valueJson'; value: string /* stringified */ }
  | { column: 'optionId'; value: string }
  | { column: 'relatedEntityId'; value: string }
  | { column: 'actorId'; value: string }

/**
 * Extract the (column, value) pair used for typed equality checks.
 * Mirrors the column selection logic in `buildFieldValueRow` /
 * `checkUniqueValueTyped`. Returned tuple is used both for write-path
 * dedup (add/remove) and for read-path equality lookups.
 */
export function typedColumnMatch(value: TypedFieldValueInput): TypedColumnMatch {
  switch (value.type) {
    case 'text':
      return { column: 'valueText', value: value.value }
    case 'number':
      return { column: 'valueNumber', value: value.value }
    case 'boolean':
      return { column: 'valueBoolean', value: value.value }
    case 'date':
      return {
        column: 'valueDate',
        value: value.value instanceof Date ? value.value.toISOString() : value.value,
      }
    case 'json':
      return { column: 'valueJson', value: JSON.stringify(value.value) }
    case 'option':
      return { column: 'optionId', value: value.optionId }
    case 'relationship': {
      const { entityInstanceId } = parseRecordId(value.recordId)
      return { column: 'relatedEntityId', value: entityInstanceId }
    }
    case 'actor':
      // Users + agents both live in actorId column (agent disambiguated by
      // relatedEntityDefinitionId='agent' at the row level). Groups live in
      // relatedEntityId. For equality match here, the column choice is the
      // same for user/agent — the actor row's id is what gets compared.
      if (value.actorType === 'user' || value.actorType === 'agent') {
        return { column: 'actorId', value: value.id }
      }
      return { column: 'relatedEntityId', value: value.id }
  }
}
