// packages/lib/src/conditions/collect-field-ids.ts
// Walk a condition-group tree and collect the field refs it touches. Used by the
// record-rules sync consumer to decide whether a rule can be evaluated against a
// partial (manifest-derived) snapshot or needs a full record fetch (B2 plan D6).

import type { Condition, ConditionGroup } from './types'

/** Result of walking a condition tree for its field references. */
export interface CollectedConditionFields {
  /**
   * Direct (single-segment) field refs — the raw `condition.fieldId` string as stored.
   * Resolvable against a record's own snapshot via `buildFieldKeyMap`.
   */
  fieldRefs: string[]
  /**
   * True when ANY condition traverses a relationship path (array fieldId form,
   * e.g. `['product:vendor', 'vendor:name']`). The snapshot evaluator only reads the
   * LAST path segment (conditions/evaluate.ts extractFieldId), so a partial snapshot
   * built from the changed record's own fields CANNOT satisfy such a condition — the
   * caller MUST take the full-snapshot (related-fetch) path. Not fixed here by design.
   */
  hasRelationshipPath: boolean
}

function walkCondition(condition: Condition, refs: Set<string>, flag: { path: boolean }): void {
  const { fieldId, subConditions } = condition

  if (Array.isArray(fieldId)) {
    // Relationship path — cannot resolve within a single record's snapshot.
    flag.path = true
  } else if (typeof fieldId === 'string' && fieldId.length > 0) {
    refs.add(fieldId)
  }

  if (subConditions?.length) {
    for (const sub of subConditions) walkCondition(sub, refs, flag)
  }
}

/**
 * Collect every field ref a condition tree references. Handles nested groups,
 * sub-conditions, empty inputs, and flags relationship-path refs.
 */
export function collectConditionFieldIds(groups: ConditionGroup[]): CollectedConditionFields {
  const refs = new Set<string>()
  const flag = { path: false }

  for (const group of groups ?? []) {
    for (const condition of group.conditions ?? []) {
      walkCondition(condition, refs, flag)
    }
  }

  return { fieldRefs: [...refs], hasRelationshipPath: flag.path }
}
