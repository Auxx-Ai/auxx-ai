// packages/lib/src/ai/kopilot/capabilities/entities/shared/record-filters.ts

import type { ResourceFieldId } from '@auxx/types/field'
import { toResourceFieldId } from '@auxx/types/field'
import { z } from 'zod'
import { findCachedResource, getCachedResources } from '../../../../../cache/org-cache-helpers'
import type { Condition, ConditionGroup } from '../../../../../conditions'
import {
  isOperatorValidForFieldType,
  OPERATOR_DEFINITIONS,
  type Operator,
} from '../../../../../conditions/operator-definitions'
import { UnprocessableEntityError } from '../../../../../errors'
import type { CountFilteredResult } from '../../../../../resources/crud'
import { getFieldOptions } from '../../../../../resources/registry/option-helpers'
import type { Resource } from '../../../../../resources/registry/types'
import { isAiBlockedResource } from './ai-entity-visibility'

/**
 * Shared entity-filter grammar for Kopilot record tools.
 *
 * The LLM-facing filter shape (`SimplifiedFilter`), the entity resolver, the
 * front-door validator, and the `ConditionGroup` builder are reused by
 * `query_records` (read) and the records-page view tools (preview/create). One
 * grammar, one operator catalog, one validation pass — so the model reuses what
 * it already knows.
 *
 * NOTE on field id conventions: `convertToConditionGroup` builds an
 * **apiSlug-prefixed** `ResourceFieldId` (`toResourceFieldId(apiSlug, key)`),
 * which is what the kopilot `UnifiedCrudHandler.listFiltered` path expects. The
 * records *table store / saved view* layer uses a different,
 * `entityDefinitionId`-prefixed column-id convention — see the record-views
 * `build-view-config` builder. Don't cross the two.
 */

export interface SimplifiedFilter {
  field: string
  operator: string
  value?: unknown
}

/** Dropped-filter warning surfaced to the LLM. */
export type QueryWarning =
  | { kind: 'unknown_field'; field: string; hint: string }
  | { kind: 'unknown_operator'; operator: string; field: string; hint: string }
  | {
      kind: 'operator_type_mismatch'
      operator: string
      field: string
      fieldType: string
      hint: string
    }
  | {
      kind: 'invalid_option_value'
      field: string
      value: unknown
      validValues: string[]
      hint: string
    }
  | { kind: 'empty_in_array'; field: string; hint: string }
  | { kind: 'multi_hop_dot_notation'; field: string; hint: string }
  | { kind: 'entity_name_normalized'; from: string; to: string; hint: string }
  | { kind: 'invalid_value'; field: string; operator: string; value: unknown; hint: string }
  /**
   * A filter that passed {@link validateFilters} and then produced no SQL in the
   * query builder. Distinct from every other kind here: those are front-door
   * rejections the LLM can fix from the hint alone, this one means the number
   * the tool is about to report counts MORE records than were asked for.
   */
  | { kind: 'filter_not_applied'; field: string; operator: string; hint: string }

/** Zod mirror of {@link QueryWarning} for tool output schemas. */
export const QueryWarningSchema = z.object({
  kind: z.string(),
  field: z.string().optional(),
  operator: z.string().optional(),
  fieldType: z.string().optional(),
  value: z.unknown().optional(),
  validValues: z.array(z.string()).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  hint: z.string(),
})

/**
 * Resolve an entity reference to a Resource.
 * Tries exact match first (id / entityType / apiSlug), then falls back to
 * case-insensitive match on apiSlug / label / plural, with naive singular-
 * plural normalization (trailing 's').
 *
 * `blocked` is returned for defs the generic record path refuses
 * ({@link isAiBlockedResource} — `thread` / `message`, whose content is governed
 * by the mail lens). The check runs on the **resolved** resource, after every
 * naming has collapsed to one identity, so `thread`, `threads`, `Threads` and the
 * `threads` apiSlug are all covered by one rule. Callers must handle this kind —
 * that is the point of it being a resolution outcome rather than a per-tool
 * string comparison.
 */
export type EntityResolution =
  | { kind: 'exact'; resource: Resource }
  | { kind: 'normalized'; resource: Resource }
  | { kind: 'blocked'; resource: Resource }
  | { kind: 'ambiguous'; candidates: string[] }
  | { kind: 'not_found' }

export async function resolveEntity(orgId: string, key: string): Promise<EntityResolution> {
  const exact = await findCachedResource(orgId, key)
  if (exact) {
    return isAiBlockedResource(exact)
      ? { kind: 'blocked', resource: exact }
      : { kind: 'exact', resource: exact }
  }

  const all = await getCachedResources(orgId)
  const lower = key.toLowerCase()
  const plural = `${lower}s`
  const singular = lower.endsWith('s') ? lower.slice(0, -1) : lower

  const matches = all.filter((r) => {
    const slug = r.apiSlug.toLowerCase()
    const label = r.label.toLowerCase()
    const rPlural = r.plural.toLowerCase()
    return (
      slug === lower ||
      label === lower ||
      rPlural === lower ||
      slug === plural ||
      slug === singular ||
      rPlural === plural ||
      label === singular
    )
  })

  // A fuzzy match onto a blocked def must not read as "not found" — the model
  // needs to be told which tool to call instead. It also must not shadow a real
  // record type that happens to fuzzy-match the same word, so the allowed
  // candidates are resolved first and the block only answers when none survive.
  const allowed = matches.filter((r) => !isAiBlockedResource(r))
  if (allowed.length === 1) return { kind: 'normalized', resource: allowed[0]! }
  if (allowed.length > 1) {
    return { kind: 'ambiguous', candidates: allowed.map((r) => r.apiSlug) }
  }
  const blocked = matches.find((r) => isAiBlockedResource(r))
  if (blocked) return { kind: 'blocked', resource: blocked }
  return { kind: 'not_found' }
}

/**
 * Validate filters against the resource's fields and the operator catalog
 * before they reach SQL generation.
 *
 * Every rejected filter produces a warning with an actionable hint so the LLM
 * can self-correct in one turn. Valid filters pass through unchanged.
 */
export function validateFilters(
  filters: SimplifiedFilter[],
  resource: Resource
): { valid: SimplifiedFilter[]; warnings: QueryWarning[] } {
  const valid: SimplifiedFilter[] = []
  const warnings: QueryWarning[] = []
  const fieldIds = resource.fields.map((f) => f.systemAttribute ?? f.key)

  for (const filter of filters) {
    // Multi-hop dot notation (`a.b.c`) — only single-level relationships supported
    const parts = filter.field.split('.')
    if (parts.length > 2) {
      warnings.push({
        kind: 'multi_hop_dot_notation',
        field: filter.field,
        hint: `Path "${filter.field}" has more than one level. Only single-level relationships are supported (e.g. "company.name" OK, "company.country.name" NOT OK).`,
      })
      continue
    }

    // Field existence (use the root segment for dot notation)
    const rootField = parts[0] ?? ''
    const fieldDef = resource.fields.find(
      (f) => f.systemAttribute === rootField || f.key === rootField
    )
    if (!fieldDef) {
      warnings.push({
        kind: 'unknown_field',
        field: filter.field,
        hint: `Field "${filter.field}" not found on "${resource.label}". Call list_entity_fields to discover valid field IDs. Available: ${fieldIds.join(', ')}`,
      })
      continue
    }

    // Operator existence
    const opDef = OPERATOR_DEFINITIONS[filter.operator as Operator]
    if (!opDef) {
      warnings.push({
        kind: 'unknown_operator',
        operator: filter.operator,
        field: filter.field,
        hint: `Operator "${filter.operator}" is not recognized. Common operators: is, is not, contains, not contains, empty, not empty, in, not in, >, <, >=, <=, before, after.`,
      })
      continue
    }

    // Operator/type compatibility. Custom fields expose `fieldType` (FieldType enum)
    // which has its own supportedFieldTypes check; system fields only have `type` (BaseType).
    if (fieldDef.fieldType) {
      if (!isOperatorValidForFieldType(filter.operator as Operator, fieldDef.fieldType)) {
        warnings.push({
          kind: 'operator_type_mismatch',
          operator: filter.operator,
          field: filter.field,
          fieldType: fieldDef.fieldType,
          hint: `Operator "${filter.operator}" is not valid for field "${fieldDef.label}" (type: ${fieldDef.fieldType}).`,
        })
        continue
      }
    } else if (!(opDef.supportedTypes as readonly string[]).includes(fieldDef.type)) {
      warnings.push({
        kind: 'operator_type_mismatch',
        operator: filter.operator,
        field: filter.field,
        fieldType: fieldDef.type,
        hint: `Operator "${filter.operator}" is not valid for field "${fieldDef.label}" (type: ${fieldDef.type}).`,
      })
      continue
    }

    // Date value shape — the operator is valid for the field, but the value has
    // to match it. Catches relative-token hallucinations like `after: "now-30d"`
    // that would otherwise save a filter the records table UI can't render.
    if (opDef.category === 'date' && opDef.requiresValue) {
      const wantsDayCount =
        filter.operator === 'within_days' || filter.operator === 'older_than_days'
      if (wantsDayCount) {
        const days = typeof filter.value === 'number' ? filter.value : Number(filter.value)
        if (!Number.isFinite(days)) {
          warnings.push({
            kind: 'invalid_value',
            field: filter.field,
            operator: filter.operator,
            value: filter.value,
            hint: `"${filter.operator}" expects a NUMBER of days (e.g. 30), not "${String(filter.value)}". For "in the last 30 days" use within_days with value 30.`,
          })
          continue
        }
      } else {
        // before / after / on_date / not_on_date — absolute date.
        const ts =
          filter.value instanceof Date
            ? filter.value.getTime()
            : new Date(filter.value as string).getTime()
        if (Number.isNaN(ts)) {
          warnings.push({
            kind: 'invalid_value',
            field: filter.field,
            operator: filter.operator,
            value: filter.value,
            hint: `"${filter.operator}" expects an absolute date like "2026-05-30", not "${String(filter.value)}". For relative ranges use within_days (last N days), or this_month / this_week / today (no value).`,
          })
          continue
        }
      }
    }

    // Empty in/not-in array — drops silently in SQL, meaningless intent from the LLM
    if (
      (filter.operator === 'in' || filter.operator === 'not in') &&
      Array.isArray(filter.value) &&
      filter.value.length === 0
    ) {
      warnings.push({
        kind: 'empty_in_array',
        field: filter.field,
        hint: `Operator "${filter.operator}" on "${filter.field}" received an empty array. Pass at least one value.`,
      })
      continue
    }

    // Option value validation for fields with options (select, multi-select, status, etc.)
    const options = getFieldOptions(fieldDef)
    const checksValue =
      opDef.requiresValue &&
      (filter.operator === 'is' ||
        filter.operator === 'is not' ||
        filter.operator === 'in' ||
        filter.operator === 'not in')
    if (options.length > 0 && checksValue && filter.value != null) {
      const values = Array.isArray(filter.value) ? filter.value : [filter.value]
      const validValues = options.map((o) => o.value)
      const invalid = values.filter((v) => typeof v === 'string' && !validValues.includes(v))
      if (invalid.length > 0) {
        warnings.push({
          kind: 'invalid_option_value',
          field: filter.field,
          value: filter.value,
          validValues,
          hint: `Value ${invalid.map((v) => `"${v}"`).join(', ')} is not a valid option for "${fieldDef.label}". Use the option value key (e.g. "ACTIVE"), not the display label. Valid values: ${validValues.join(', ')}`,
        })
        continue
      }
    }

    valid.push(filter)
  }

  return { valid, warnings }
}

/** A dropped condition's field reference as one readable token. */
function describeFieldRef(fieldRef: string | string[]): string {
  return Array.isArray(fieldRef) ? fieldRef.join('.') : fieldRef
}

/**
 * The AI boundary's verdict on a count whose filters did not all compile.
 *
 * `validateFilters` is the front door and catches malformed input; this is the
 * back door, where a filter that looked fine produced no SQL anyway (a retired
 * field, an operator the field's builder cannot express, an unresolvable
 * `valueSource`). The list lane treats that as "wider, and said so" — correct
 * there, because the extra rows are visible on screen. A count has no such tell:
 * it is one number that reads exactly as authoritative when it is the unfiltered
 * total, and an agent will state it as fact.
 *
 * So the rule is asymmetric, and deliberately so:
 *
 * - **Every** condition dropped ⇒ throw. The answer would not be a wider answer
 *   to the question asked, it would be the answer to a different question
 *   ("how many tickets exist" for "how many open tickets"). This is the same
 *   line `inspectFilterConditions` draws, and `allConditionsDropped` is the
 *   same discriminant — `false` for the genuine no-filter case, so an unfiltered
 *   `countOnly: true` still answers.
 * - **Some** conditions dropped ⇒ answer, with a warning per drop. The count is
 *   still too high, but the surviving conditions did narrow it, and the model
 *   can see exactly which one to fix.
 *
 * @param resourceLabel - Human label of the counted resource, for the message.
 * @returns One `filter_not_applied` warning per reported drop; empty when clean.
 * @throws UnprocessableEntityError when every requested condition was dropped.
 */
export function assertCountFiltersApplied(
  count: CountFilteredResult,
  resourceLabel: string
): QueryWarning[] {
  const notices = count.droppedConditions ?? []
  const named = notices.map((d) => `'${describeFieldRef(d.fieldRef)}' ${d.operator}`).join(', ')

  if (count.allConditionsDropped) {
    throw new UnprocessableEntityError(
      `None of the ${count.droppedConditionCount ?? notices.length} filter condition(s) could be applied${
        named ? ` (${named})` : ''
      }, so this count would be the UNFILTERED total for "${resourceLabel}" reported as a filtered one. ` +
        'Call list_entity_fields to check field ids and operators, then retry.'
    )
  }

  return notices.map((d) => ({
    kind: 'filter_not_applied' as const,
    field: describeFieldRef(d.fieldRef),
    operator: d.operator,
    hint: `Filter "${describeFieldRef(d.fieldRef)} ${d.operator}" could not be applied (${d.reason}) and was ignored — the count above is HIGHER than the filters ask for. Call list_entity_fields to check the field id and operator.`,
  }))
}

/**
 * Convert simplified AI filters to a ConditionGroup keyed by **apiSlug-prefixed**
 * ResourceFieldIds — the convention `UnifiedCrudHandler.listFiltered` expects.
 */
export function convertToConditionGroup(
  filters: SimplifiedFilter[],
  resource: Resource,
  logicalOperator: 'AND' | 'OR' = 'AND'
): ConditionGroup | null {
  if (filters.length === 0) return null

  const conditions: Condition[] = filters.map((f, i) => ({
    id: `filter-${i}`,
    fieldId: resolveFieldId(f.field, resource),
    operator: f.operator as Condition['operator'],
    value: f.value,
  }))

  return {
    id: 'ai-filter-group',
    conditions,
    logicalOperator,
  }
}

/**
 * Resolves a simplified field reference to the format EntityConditionBuilder expects.
 *
 * Input formats:
 *   "status"         → direct field on the entity → ResourceFieldId
 *   "company.name"   → relationship path → ResourceFieldId[]
 */
export function resolveFieldId(
  field: string,
  resource: Resource
): ResourceFieldId | ResourceFieldId[] {
  if (!field.includes('.')) {
    return resolveDirectField(field, resource)
  }
  return resolveRelationshipPath(field, resource)
}

/**
 * Resolves a direct field key to a ResourceFieldId.
 * Lookup: systemAttribute → key → fallback construct.
 */
function resolveDirectField(field: string, resource: Resource): ResourceFieldId {
  const resourceField = resource.fields.find((f) => f.systemAttribute === field || f.key === field)

  if (resourceField) {
    const fieldKey = resourceField.systemAttribute ?? resourceField.key
    return toResourceFieldId(resource.apiSlug, fieldKey)
  }

  // Fallback — let EntityConditionBuilder resolve it
  return toResourceFieldId(resource.apiSlug, field)
}

/**
 * Resolves dot notation to a FieldPath (ResourceFieldId[]).
 * Example: "company.name" on Contact → ["contact:company", "company:name"]
 * Only single-level nesting supported (2-element paths).
 */
function resolveRelationshipPath(dotNotation: string, resource: Resource): ResourceFieldId[] {
  const parts = dotNotation.split('.')

  if (parts.length !== 2) {
    // Only single-level supported — fall back
    return [toResourceFieldId(resource.apiSlug, dotNotation)]
  }

  const [relationshipFieldKey, targetFieldKey] = parts as [string, string]

  // Find the relationship field on the source entity
  const relationshipField = resource.fields.find(
    (f) =>
      (f.systemAttribute === relationshipFieldKey || f.key === relationshipFieldKey) &&
      (f.fieldType === 'RELATIONSHIP' || f.type === 'object')
  )

  if (!relationshipField) {
    // Field not found or not a relationship — construct best-effort path
    return [
      toResourceFieldId(resource.apiSlug, relationshipFieldKey),
      toResourceFieldId(relationshipFieldKey, targetFieldKey),
    ]
  }

  return [
    toResourceFieldId(resource.apiSlug, relationshipField.systemAttribute ?? relationshipField.key),
    toResourceFieldId(relationshipFieldKey, targetFieldKey),
  ]
}
