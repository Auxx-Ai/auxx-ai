// packages/lib/src/agents/procedures/context.ts

import type { VarRef } from '@auxx/types/field'
import type { Subject, ToolContext } from '../../ai/agent-framework/tool-context'
import type { FieldResolver } from '../../conditions/evaluate'
import type { ConditionGroup } from '../../conditions/types'
import { buildResolveVarSource } from '../bindings/resolve'

/**
 * The deterministic selection pre-filter (`select.ts`) gates candidate procedures
 * with `evaluateConditions(entity, ruleset, resolver)` — a **synchronous** evaluator
 * (`conditions/evaluate.ts`, shared with client-side view filters). The procedure
 * rulesets reference fields off the turn's `Subject` anchors, resolved by the v8
 * binding resolver `buildResolveVarSource(ctx)` — which is **async**
 * (`batchGetValues`). We bridge the two by **pre-resolving** every field a candidate
 * ruleset references into an in-memory sync map, once per turn, before evaluating.
 *
 * Procedure-local `var:*` are deliberately NOT available here: the procedure hasn't
 * run yet, so the only readable axis at selection is the subject (PROCEDURE-STACK #5).
 */

/**
 * Extract the **simple** field id the synchronous evaluator looks up — it strips the
 * `entityDef:` prefix and, for a relationship path, uses the LAST segment's simple
 * name. This MUST stay byte-for-byte aligned with `evaluate.ts`'s `extractFieldId` /
 * `extractSimpleField`, or the pre-resolved map is keyed differently than the
 * evaluator reads it and every lookup silently returns `undefined`.
 */
function simpleKey(fieldId: string | string[]): string {
  if (Array.isArray(fieldId)) return stripEntityDef(fieldId[fieldId.length - 1] ?? '')
  return stripEntityDef(fieldId)
}

function stripEntityDef(fieldId: string): string {
  const colon = fieldId.indexOf(':')
  return colon === -1 ? fieldId : fieldId.slice(colon + 1)
}

/**
 * Build a `VarRef` from a condition `fieldId`. A `ResourceFieldId[]` is a `FieldPath`;
 * a scoped `entityDef:field` string is a `ResourceFieldId`. A bare legacy field id
 * (no `:`, no entity root) cannot be rooted at a subject anchor, so it has no var
 * source — we return `null` and the field resolves to `undefined` (gate-by-absence).
 */
function toVarRef(fieldId: string | string[]): VarRef | null {
  if (Array.isArray(fieldId)) return fieldId.length > 0 ? (fieldId as VarRef) : null
  return fieldId.includes(':') ? (fieldId as VarRef) : null
}

/**
 * Collect every distinct condition `fieldId` referenced across a set of rulesets, so
 * each is resolved exactly once. Mirrors the evaluator's reach: top-level groups,
 * each group's `conditions` (the evaluator does not recurse `subConditions`).
 */
function collectFieldRefs(groups: ConditionGroup[]): (string | string[])[] {
  const out: (string | string[])[] = []
  for (const group of groups) {
    for (const condition of group.conditions) {
      out.push(condition.fieldId)
    }
  }
  return out
}

/**
 * Build the synchronous `FieldResolver` selection conditions evaluate against, by
 * PRE-RESOLVING each referenced field off `subject.anchors` via the v8 resolver into
 * a map keyed by the evaluator's *simple* field id.
 *
 * Gate-by-absence: an absent anchor (anonymous participant, no `contact`) yields
 * `undefined` from the v8 resolver, so the predicate sees a missing value — exactly
 * the property `evaluateConditions` relies on (`empty` / `is not` behave correctly on
 * `undefined`). Internal runs pass an empty-anchors `Subject`, so every field is
 * `undefined` and a ruleset requiring a present field simply doesn't match.
 *
 * @param allGroups union of every candidate ruleset — resolve the field set once.
 */
export async function buildProcedureFieldResolver(
  ctx: ToolContext,
  subject: Subject,
  allGroups: ConditionGroup[]
): Promise<FieldResolver<Subject>> {
  const resolveVar = buildResolveVarSource(ctx)
  const values = new Map<string, unknown>()
  const seen = new Set<string>()

  for (const fieldId of collectFieldRefs(allGroups)) {
    const key = simpleKey(fieldId)
    if (seen.has(key)) continue
    seen.add(key)
    const ref = toVarRef(fieldId)
    if (!ref) {
      values.set(key, undefined)
      continue
    }
    try {
      values.set(key, await resolveVar({ kind: 'var', ref }, subject))
    } catch {
      // Selection is best-effort routing — a resolver misconfig gates by absence
      // rather than throwing the whole turn.
      values.set(key, undefined)
    }
  }

  // The evaluator hands us the already-simplified field id (`extractFieldId`); the
  // `entity` arg is ignored — we read the pre-resolved map.
  return (_entity, fieldId) => values.get(fieldId)
}
