// packages/lib/src/sequences/enrollment-filter.ts
// Enrollment-filter evaluation for event-triggered sequences (client-notifications plan
// §4.1 decision #17 / §4.3). `Sequence.enrollmentFilter` is an optional `ConditionGroup[]`
// evaluated once at enroll time against the subject's root entity record — work_order for
// visit/work_order subjects, invoice for invoice subjects.
//
// This reuses the in-memory condition evaluator (`@auxx/lib/conditions`), but the evaluator's
// own path-collapsing (`extractFieldId` reduces a relationship path array — e.g.
// `['work_order:contact', 'contact:name']` — to its LAST segment before ever calling the
// resolver) throws away which root a field came from. Unlike `record-rules`'
// `makeSnapshotResolver` (a flat, single-entity resolver with no notion of a related record),
// this builds a small multi-root resolver the way `agents/procedures/context.ts`'s
// `buildProcedureFieldResolver` does: walk every condition's `fieldId` up front, resolve each
// one (a direct root-entity field, OR a single relationship hop via
// `fetchResourceWithRelationships`) into a flat `Map` keyed by the exact simple id the
// evaluator will look up, then hand back a trivial synchronous `Map.get` resolver.
//
// v1 scope (decision #17 — "no per-step conditions, no branching", simple filters only):
// supports a direct root-entity field OR exactly one relationship hop. Deeper paths are logged
// and treated as unresolved (`FIELD_NOT_RESOLVABLE` — "pass", same as the evaluator's own
// server-already-filtered convention) rather than silently blocking every enrollment.

import { createScopedLogger } from '@auxx/logger'
import { toRecordId } from '@auxx/types/resource'
import { getCachedResourceFields } from '../cache'
import {
  evaluateConditions,
  FIELD_NOT_RESOLVABLE,
  type FieldResolver,
  normalizeStatusConditions,
} from '../conditions/evaluate'
import type { Condition, ConditionGroup } from '../conditions/types'
import { buildFieldKeyMap } from '../record-rules/resolver'
import { fetchResourceById, fetchResourceWithRelationships } from '../resources/resource-fetcher'

const logger = createScopedLogger('sequences-enrollment-filter')

/** Mirrors the evaluator's own private `extractSimpleField` (`conditions/evaluate.ts`) —
 * strips an `entityDef:field` prefix down to the bare field name. */
function extractSimpleField(fieldId: string): string {
  const colonIndex = fieldId.indexOf(':')
  return colonIndex === -1 ? fieldId : fieldId.slice(colonIndex + 1)
}

/** Mirrors the evaluator's own private `extractFieldId` — the exact simple key
 * `evaluateConditions` will call the resolver with for this condition. */
function simpleKeyFor(fieldId: string | string[]): string {
  if (Array.isArray(fieldId)) return extractSimpleField(fieldId[fieldId.length - 1] ?? '')
  return extractSimpleField(fieldId)
}

function collectConditions(groups: ConditionGroup[]): Condition[] {
  const out: Condition[] = []
  for (const group of groups) out.push(...group.conditions)
  return out
}

/** Read a field's value off a `fetchResourceById`-shaped snapshot (`{ fieldValues, ...top }`),
 * given the field's resolved output key. */
function readSnapshotValue(snapshot: any, key: string): unknown {
  if (!snapshot) return undefined
  if (snapshot.fieldValues && key in snapshot.fieldValues) return snapshot.fieldValues[key]
  return snapshot[key]
}

/**
 * Evaluate a sequence's `enrollmentFilter` against a subject's root entity record.
 * `groups` empty/null ⇒ `true` (enroll everything, the default). Fails OPEN on internal
 * errors (logged) — a filter-evaluation bug should not silently block every enrollment; the
 * "recipient missing" / "not enabled" guards already in front of this call in
 * `enrollSubjectInSequence` are the real safety net.
 */
export async function evaluateEnrollmentFilter(
  organizationId: string,
  rootEntityDefinitionId: string,
  rootEntityInstanceId: string,
  groups: ConditionGroup[] | null | undefined
): Promise<boolean> {
  if (!groups || groups.length === 0) return true
  const normalized = normalizeStatusConditions(groups)
  const conditions = collectConditions(normalized)
  if (conditions.length === 0) return true

  try {
    const rootRecordId = toRecordId(rootEntityDefinitionId, rootEntityInstanceId)
    const rootFields = await getCachedResourceFields(organizationId, rootEntityDefinitionId)
    const rootKeyMap = buildFieldKeyMap(rootFields)

    // One-hop relationship names any condition's path needs (e.g. 'contact' from
    // ['work_order:contact', 'contact:name']) — fetched together in one call.
    const relationshipNames = new Set<string>()
    for (const condition of conditions) {
      if (Array.isArray(condition.fieldId) && condition.fieldId.length === 2) {
        relationshipNames.add(extractSimpleField(condition.fieldId[0] as string))
      }
    }

    const rootResource =
      relationshipNames.size > 0
        ? await fetchResourceWithRelationships(
            rootRecordId,
            Array.from(relationshipNames),
            organizationId
          )
        : await fetchResourceById(rootRecordId, organizationId)

    if (!rootResource) return false // subject's root record vanished — safest is "don't match"

    // Related entities' field key-maps, cached per relationship name — resolved lazily from
    // the nested snapshot's own `entityDefinitionId` (no need to know the target def up front).
    const relatedKeyMaps = new Map<string, Map<string, string> | null>()
    async function relatedKeyMap(relName: string): Promise<Map<string, string> | null> {
      if (relatedKeyMaps.has(relName)) return relatedKeyMaps.get(relName) ?? null
      const nested = rootResource[relName]
      const nestedDefId = nested?.entityDefinitionId
      if (!nestedDefId) {
        relatedKeyMaps.set(relName, null)
        return null
      }
      const fields = await getCachedResourceFields(organizationId, nestedDefId)
      const map = buildFieldKeyMap(fields)
      relatedKeyMaps.set(relName, map)
      return map
    }

    const values = new Map<string, unknown>()
    for (const condition of conditions) {
      const simpleKey = simpleKeyFor(condition.fieldId)
      if (values.has(simpleKey)) continue // documented collision limitation — first wins

      if (Array.isArray(condition.fieldId)) {
        if (condition.fieldId.length !== 2) {
          if (condition.fieldId.length > 2) {
            logger.warn(
              'Enrollment filter path deeper than one relationship hop — skipping condition',
              { organizationId, fieldId: condition.fieldId }
            )
          }
          values.set(simpleKey, undefined)
          continue
        }
        const relName = extractSimpleField(condition.fieldId[0] as string)
        const nested = rootResource[relName]
        if (!nested) {
          values.set(simpleKey, undefined)
          continue
        }
        const keyMap = await relatedKeyMap(relName)
        const key = keyMap?.get(simpleKey) ?? simpleKey
        values.set(simpleKey, readSnapshotValue(nested, key))
      } else {
        const key = rootKeyMap.get(simpleKey) ?? simpleKey
        values.set(simpleKey, readSnapshotValue(rootResource, key))
      }
    }

    const resolver: FieldResolver<unknown> = (_entity, fieldId) =>
      values.has(fieldId) ? values.get(fieldId) : FIELD_NOT_RESOLVABLE

    return evaluateConditions(rootResource, normalized, resolver)
  } catch (error) {
    logger.error('Enrollment filter evaluation failed — failing open (enroll)', {
      organizationId,
      rootEntityDefinitionId,
      rootEntityInstanceId,
      error: error instanceof Error ? error.message : String(error),
    })
    return true
  }
}
