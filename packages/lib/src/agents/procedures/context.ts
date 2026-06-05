// packages/lib/src/agents/procedures/context.ts

import type { VarRef } from '@auxx/types/field'
import type { Subject, ToolContext } from '../../ai/agent-framework/tool-context'
import type { FieldResolver } from '../../conditions/evaluate'
import type { ConditionGroup } from '../../conditions/types'
import { buildResolveVarSource } from '../bindings/resolve'
import type { ProcedureFrame } from './types'

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

// ── Phase 3: in-procedure `condition` predicates ───────────────────────────

/** The `var:` prefix a declared local-attribute condition field carries (`use-procedure-condition-config.ts`). */
const LOCAL_ATTR_PREFIX = 'var:'

/**
 * The Context-Variables store key a declared procedure-local attribute resolves
 * to — namespaced by the **running procedure version**, NOT the frame. The same
 * `procedureVersionId` is deliberate both ways (README / PROCEDURE-STACK #5):
 *
 *  - a LOCAL `call` frame carries the *same* `procedureVersionId` as its caller,
 *    so a sub-procedure **shares** the parent's locals (how it returns a value);
 *  - a CROSS-procedure push (`switch` / `digression`) carries a *different*
 *    `procedureVersionId`, so it gets an **isolated** scope and can't clobber a
 *    parent's `var:*`.
 *
 * Colons stay inside the store key's `root` (`parseContextRef` only splits a
 * `var:` ref on `.` / `[`), so this is a single flat key. `name` is expected to
 * be a plain identifier; a name containing `.`/`[` would nest (authoring contract).
 */
export function scopedVar(frame: ProcedureFrame, name: string): string {
  return `var:__la:${frame.procedureVersionId}:${name}`
}

/**
 * Build the synchronous {@link FieldResolver} an in-procedure `condition` step
 * evaluates against. Unlike selection's resolver ({@link buildProcedureFieldResolver}),
 * this one ALSO reads procedure-local `var:*` scratch — the procedure is running,
 * so its declared `localAttributes` are readable (PROCEDURE-STACK #5). It reads:
 *
 *  - `var:<name>` — a declared local attribute, via `ctx.context.read` of the
 *    version-scoped key ({@link scopedVar}); absent → `undefined` (gate-by-absence).
 *  - any other `fieldId` — a CRM `FieldReference` resolved off `ctx.subject.anchors`
 *    by the v8 resolver, exactly like selection.
 *
 * It deliberately does NOT resolve `tool:*` / `call:*` — those are latest-wins,
 * turn-scoped captures, ambiguous when a tool runs more than once. Procedure logic
 * reads named attributes only; a tool result reaches a condition solely by being
 * written into a `localAttribute`.
 *
 * `evaluateConditions` is **synchronous** but reads (store + v8 resolver) are
 * **async**, so the caller {@link prime}s every referenced field into an in-memory
 * map first; the returned `resolver` is then a pure `Map.get` keyed by the
 * evaluator's *simple* field id (`var:cancel_result` → `cancel_result`, byte-for-byte
 * aligned with `evaluate.ts` `extractFieldId`). `prime` is incremental + idempotent
 * (a field is resolved once), so the stepper can call it per `condition` step as it
 * advances through several in one turn, accumulating into the shared map.
 */
export function buildProcedurePredicateResolver(
  ctx: ToolContext,
  frame: ProcedureFrame
): { resolver: FieldResolver<unknown>; prime: (groups: ConditionGroup[]) => Promise<void> } {
  const resolveVar = buildResolveVarSource(ctx)
  const subject = ctx.subject
  const values = new Map<string, unknown>()
  const seen = new Set<string>()

  const resolveOne = async (fieldId: string | string[]): Promise<unknown> => {
    // Declared local attribute (`var:<name>`) — read the version-scoped store key.
    if (typeof fieldId === 'string' && fieldId.startsWith(LOCAL_ATTR_PREFIX)) {
      try {
        return await ctx.context.read(scopedVar(frame, fieldId.slice(LOCAL_ATTR_PREFIX.length)))
      } catch {
        return undefined
      }
    }
    // CRM FieldReference — resolve off subject anchors (v8), gate-by-absence. A bare
    // legacy id (no entity root) or a missing subject yields `undefined`.
    const ref = toVarRef(fieldId)
    if (!ref || !subject) return undefined
    try {
      return await resolveVar({ kind: 'var', ref }, subject)
    } catch {
      // In-procedure predicates are best-effort — a misconfig gates by absence
      // rather than throwing the turn.
      return undefined
    }
  }

  const prime = async (groups: ConditionGroup[]): Promise<void> => {
    for (const fieldId of collectFieldRefs(groups)) {
      const key = simpleKey(fieldId)
      if (seen.has(key)) continue
      seen.add(key)
      values.set(key, await resolveOne(fieldId))
    }
  }

  return { resolver: (_entity, fieldId) => values.get(fieldId), prime }
}
