// packages/lib/src/resources/query-builder/canonicalize-system-fields.ts

import { parseResourceFieldId, type ResourceFieldId } from '@auxx/types/field'
import { RESOURCE_FIELD_REGISTRY, type TableId } from '../registry/field-registry'
import type { ResourceField } from '../registry/field-types'
import type { ConditionGroup, GenericCondition } from './base-condition-builder'

/** The static registry slice for one system table, keyed by static field key. */
type RegistrySlice = Record<string, ResourceField> | undefined

/** Merged org fields indexed by `CustomField.id` (the cuid the filter UIs send). */
type FieldsById = Map<string, ResourceField>

/**
 * Strip a `<entityDefinitionId>:` prefix, matching
 * `SystemConditionBuilder.stripFieldPrefix` exactly — including its
 * "only the first colon separates" behaviour, which comes from
 * `parseResourceFieldId`.
 */
function stripFieldPrefix(fieldRef: string): string {
  return fieldRef.includes(':')
    ? parseResourceFieldId(fieldRef as ResourceFieldId).fieldId
    : fieldRef
}

function indexFieldsById(fields: ResourceField[]): FieldsById {
  const byId: FieldsById = new Map()
  for (const field of fields) byId.set(field.id, field)
  return byId
}

/**
 * Resolve one field reference against the static registry and the org's merged
 * fields. Shared by both public entry points so they can never disagree.
 */
function canonicalizeRef(fieldRef: string, registry: RegistrySlice, byId: FieldsById): string {
  const stripped = stripFieldPrefix(fieldRef)

  // (A) Already a static registry key — the shape the builder understands.
  // Checked first, which is what makes the whole function idempotent: the
  // output of (B) lands here on a second pass and is returned untouched.
  if (registry?.[stripped]) return fieldRef

  const merged = byId.get(stripped)

  // (D) Unresolvable. Deliberately returned unchanged rather than guessed at:
  // an invented FieldValue lookup would trade today's visible fail-open (the
  // builder drops it and records a `DroppedCondition`) for a silent
  // fail-closed wrong answer.
  if (!merged) return fieldRef

  // (B) A materialized system field. Map to `key`, NEVER to `systemAttribute`:
  // `RESOURCE_FIELD_REGISTRY[tableId]` is keyed by the static field's id, which
  // for these fields equals `key` (`tags`, not `article_tags`).
  if (merged.systemAttribute) {
    return registry?.[merged.key] ? merged.key : fieldRef
  }

  // (C) A genuine custom field on a system resource. `custom_` routes
  // `conditionToSql` into `buildCustomFieldSubquery`, which strips the prefix
  // back off and matches `FieldValue.fieldId` — which is this cuid.
  return `custom_${stripped}`
}

/** Map an array, returning the input reference when every element is untouched. */
function mapPreservingIdentity<T>(items: T[], map: (item: T) => T): T[] {
  let changed = false
  const next = new Array<T>(items.length)

  for (let index = 0; index < items.length; index++) {
    const item = items[index] as T
    const mapped = map(item)
    if (mapped !== item) changed = true
    next[index] = mapped
  }

  return changed ? next : items
}

/**
 * Rewrite a condition's `fieldId`. Only element 0 of a relationship path is
 * canonicalized — that is the only element `conditionToSql` reads — and the
 * remaining hops are carried through untouched.
 */
function canonicalizeConditionFieldId(
  fieldId: GenericCondition['fieldId'],
  registry: RegistrySlice,
  byId: FieldsById
): GenericCondition['fieldId'] {
  if (Array.isArray(fieldId)) {
    const head = fieldId[0]
    if (!head) return fieldId
    const canonical = canonicalizeRef(head, registry, byId)
    if (canonical === head) return fieldId
    return [canonical as ResourceFieldId, ...fieldId.slice(1)]
  }

  return canonicalizeRef(fieldId, registry, byId)
}

function canonicalizeCondition(
  condition: GenericCondition,
  registry: RegistrySlice,
  byId: FieldsById
): GenericCondition {
  const fieldId = canonicalizeConditionFieldId(condition.fieldId, registry, byId)
  const subConditions = condition.subConditions
    ? mapPreservingIdentity(condition.subConditions, (sub) =>
        canonicalizeCondition(sub, registry, byId)
      )
    : condition.subConditions

  if (fieldId === condition.fieldId && subConditions === condition.subConditions) return condition

  const next: GenericCondition = { ...condition, fieldId }
  if (subConditions !== condition.subConditions) next.subConditions = subConditions
  return next
}

function canonicalizeGroup(
  group: ConditionGroup,
  registry: RegistrySlice,
  byId: FieldsById
): ConditionGroup {
  const conditions = mapPreservingIdentity(group.conditions, (condition) =>
    canonicalizeCondition(condition, registry, byId)
  )

  return conditions === group.conditions ? group : { ...group, conditions }
}

/**
 * Rewrite one filter field reference into the form `SystemConditionBuilder`
 * resolves.
 *
 * The filter UIs address a field on a system resource by the org's merged
 * `CustomField` **cuid** (bare from the records searchbar, `<defId>:<cuid>`
 * from the table filter builder), while the builder looks fields up in
 * `RESOURCE_FIELD_REGISTRY[tableId]`, which is keyed by the *static* key. The
 * mismatch made every such condition drop, widening the list.
 *
 * Pure and idempotent — canonicalizing twice equals canonicalizing once, so it
 * is safe to run over a stored view that already holds either shape. Anything
 * unresolvable is returned unchanged, which leaves the builder's existing
 * `DroppedCondition` reporting as the failure channel.
 *
 * @param fieldRef - Bare or `<entityDefinitionId>:`-prefixed field reference.
 * @param tableId - System table the filter runs against.
 * @param fields - The org's merged fields for that resource.
 * @returns The canonical reference, or `fieldRef` unchanged when unresolvable.
 */
export function canonicalizeSystemFieldRef(
  fieldRef: string,
  tableId: TableId,
  fields: ResourceField[]
): string {
  return canonicalizeRef(fieldRef, RESOURCE_FIELD_REGISTRY[tableId], indexFieldsById(fields))
}

/**
 * Canonicalize every condition in every group, ahead of
 * `SystemConditionBuilder` — which is left untouched.
 *
 * Never mutates the input, and allocates only for entries that actually
 * change: an all-static filter set comes back as the very same array, group
 * and condition references, so the no-op path costs nothing.
 *
 * `ConditionGroup` has no nested groups (`conditions: Condition[]` only), but a
 * `Condition` may carry `subConditions`; those are canonicalized too, so the
 * output is uniform regardless of which consumer reads them.
 *
 * @param groups - Condition groups as sent by the filter surfaces.
 * @param tableId - System table the filter runs against.
 * @param fields - The org's merged fields for that resource.
 * @returns Canonicalized groups, or `groups` itself when nothing changed.
 */
export function canonicalizeSystemConditions(
  groups: ConditionGroup[],
  tableId: TableId,
  fields: ResourceField[]
): ConditionGroup[] {
  const registry = RESOURCE_FIELD_REGISTRY[tableId]
  const byId = indexFieldsById(fields)

  return mapPreservingIdentity(groups, (group) => canonicalizeGroup(group, registry, byId))
}
