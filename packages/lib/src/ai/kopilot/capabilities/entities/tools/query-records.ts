// packages/lib/src/ai/kopilot/capabilities/entities/tools/query-records.ts

import type { ResourceFieldId } from '@auxx/types/field'
import { toResourceFieldId } from '@auxx/types/field'
import { findCachedResource, getCachedResources } from '../../../../../cache/org-cache-helpers'
import type { Condition, ConditionGroup } from '../../../../../conditions'
import {
  isOperatorValidForFieldType,
  OPERATOR_DEFINITIONS,
  type Operator,
} from '../../../../../conditions/operator-definitions'
import { UnifiedCrudHandler } from '../../../../../resources/crud'
import { getFieldOptions } from '../../../../../resources/registry/option-helpers'
import type { Resource } from '../../../../../resources/registry/types'
import { toRecordId } from '../../../../../resources/resource-id'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'

interface SimplifiedFilter {
  field: string
  operator: string
  value?: unknown
}

type QueryWarning =
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

export function createQueryRecordsTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'query_records',
    idempotent: true,
    outputBlock: 'entity-list',
    usageNotes:
      'Inspect `warnings[]` before trusting the result — each entry means a filter was rejected and dropped. `returned_count` is items in this page, `total_matching` is the full count for the query.',
    description: `Query entity records with field-level filters, sorting, and pagination.
Use list_entity_fields first to discover available fields and their valid option values.

Response shape:
- returned_count: number of items in this page
- total_matching: total records that match the filters
- warnings[]: present only when a filter was dropped (unknown field/operator, invalid option value, etc.). Read the hint and retry with the fix.

Operator notes:
- "is not X" matches records without a value too (including unset). To exclude only set values ≠ X, combine "not empty" AND "is not X".
- "empty" / "not empty": empty means the record has no value for this field.
- Dot notation: single-level only. "company.name" OK. "company.country.name" NOT supported.
- For SELECT fields: pass the option value key (e.g. "ACTIVE"), not the display label ("Active").

Examples:
- All active contacts: { entity: "contact", filters: [{ field: "status", operator: "is", value: "ACTIVE" }] }
- Companies without a website: { entity: "company", filters: [{ field: "website", operator: "empty" }] }
- Recent tickets: { entity: "ticket", sort: { field: "createdAt", direction: "desc" }, limit: 10 }
- Contacts at a company: { entity: "contact", filters: [{ field: "company", operator: "is", value: "<company-record-id>" }] }
- Active OR VIP contacts: { entity: "contact", filters: [...], logicalOperator: "OR" }
- Count all tickets: { entity: "ticket", countOnly: true }
- Count open tickets: { entity: "ticket", filters: [{ field: "status", operator: "is", value: "OPEN" }], countOnly: true }`,
    parameters: {
      type: 'object',
      properties: {
        entity: {
          type: 'string',
          description:
            'Entity type to query — use the apiSlug (e.g. "contact", "ticket") or entity definition ID from the entity catalog.',
        },
        filters: {
          type: 'array',
          description: 'Field-level filter conditions.',
          items: {
            type: 'object',
            properties: {
              field: {
                type: 'string',
                description:
                  'Field ID or systemAttribute from list_entity_fields. Supports dot notation for relationships (e.g. "company.name").',
              },
              operator: {
                type: 'string',
                description:
                  'Filter operator. Common: "is", "is not", "contains", "not contains", ">", "<", ">=", "<=", "empty", "not empty", "in", "not in", "before", "after", "today", "this_week", "this_month".',
              },
              value: {
                description:
                  'Comparison value. Use the value key from field options for select fields (e.g. "ACTIVE" not "Active"). For "in"/"not in" operators, pass an array.',
              },
            },
            required: ['field', 'operator'],
          },
        },
        logicalOperator: {
          type: 'string',
          enum: ['AND', 'OR'],
          description:
            'How to combine filters. Default: "AND". Use "OR" for "active OR VIP" style queries.',
        },
        sort: {
          type: 'object',
          description: 'Sort order',
          properties: {
            field: { type: 'string', description: 'Field to sort by' },
            direction: { type: 'string', enum: ['asc', 'desc'], description: 'Sort direction' },
          },
        },
        limit: {
          type: 'number',
          description: 'Max results (default 25, max 100)',
        },
        offset: {
          type: 'number',
          description:
            'Number of results to skip for pagination (default 0). Use with limit to page through results when hasMore is true.',
        },
        countOnly: {
          type: 'boolean',
          description:
            'Return only the total count without individual records. Use for "how many" / count questions. Much faster and lighter.',
        },
      },
      required: ['entity'],
      additionalProperties: false,
    },
    execute: async (args, agentDeps) => {
      const { db } = getDeps()
      const key = args.entity as string
      const filters = (args.filters as SimplifiedFilter[]) ?? []
      const logicalOperator = (args.logicalOperator as 'AND' | 'OR') ?? 'AND'
      const sort = args.sort as { field: string; direction: 'asc' | 'desc' } | undefined
      const countOnly = args.countOnly === true
      const limit = countOnly ? 0 : Math.min((args.limit as number) || 25, 100)
      const offset = Math.max((args.offset as number) || 0, 0)

      const warnings: QueryWarning[] = []

      // Resolve entity definition — exact match first, then case-insensitive
      // + singular/plural fallback so 'Companies', 'company', 'Company' all
      // resolve to the same resource.
      const resolution = await resolveEntity(agentDeps.organizationId, key)
      if (resolution.kind === 'ambiguous') {
        return {
          success: false,
          output: null,
          error: `Entity "${key}" is ambiguous. Did you mean: ${resolution.candidates.join(', ')}?`,
        }
      }
      if (resolution.kind === 'not_found') {
        return {
          success: false,
          output: null,
          error: `Entity type "${key}" not found. Check the entity catalog in your system prompt for available types.`,
        }
      }
      const resource = resolution.resource
      if (resolution.kind === 'normalized') {
        warnings.push({
          kind: 'entity_name_normalized',
          from: key,
          to: resource.apiSlug,
          hint: `Interpreted "${key}" as "${resource.apiSlug}". Use the apiSlug directly next time.`,
        })
      }

      const entityDefId = resource.entityDefinitionId ?? resource.id
      const handler = new UnifiedCrudHandler(agentDeps.organizationId, agentDeps.userId, db)

      // Front-door validation — reject malformed filters before SQL, surface hints to the LLM
      const { valid: validFilters, warnings: filterWarnings } = validateFilters(filters, resource)
      warnings.push(...filterWarnings)

      // If the caller sent filters but every single one was rejected, surface as an error
      // so the LLM doesn't interpret a full-table scan as a meaningful answer.
      if (filters.length > 0 && validFilters.length === 0) {
        return {
          success: false,
          output: { warnings },
          error: `All ${filters.length} filter(s) were invalid. Fix the issues in warnings and retry.`,
        }
      }

      // Convert simplified filters → ConditionGroup[]
      const conditionGroup = convertToConditionGroup(validFilters, resource, logicalOperator)

      // Build sorting
      const sorting = sort ? [{ id: sort.field, desc: sort.direction === 'desc' }] : []

      // Query filtered IDs
      const filtered = await handler.listFiltered({
        entityDefinitionId: entityDefId,
        filters: conditionGroup ? [conditionGroup] : [],
        sorting,
        limit,
        cursor: offset > 0 ? { snapshotId: '', offset } : undefined,
      })

      // Count-only mode — return just the total, skip hydration
      if (countOnly) {
        return {
          success: true,
          output: {
            entityType: resource.label,
            total_matching: filtered.total,
            warnings: warnings.length > 0 ? warnings : undefined,
          },
        }
      }

      // Hydrate results with display data
      const recordIds = filtered.ids.map((id) => toRecordId(entityDefId, id))
      const recordMap = recordIds.length > 0 ? await handler.getByIds(recordIds) : {}

      const items = recordIds.map((recordId) => {
        const record = recordMap[recordId]
        if (!record) return { recordId, displayName: '(unknown)' }

        return {
          recordId,
          displayName: record.displayName,
          secondaryInfo: record.secondaryInfo ?? null,
          ...extractKeyFields(record.data, resource, validFilters),
        }
      })

      return {
        success: true,
        output: {
          entityType: resource.label,
          items,
          returned_count: items.length,
          total_matching: filtered.total,
          hasMore: filtered.hasMore,
          warnings: warnings.length > 0 ? warnings : undefined,
        },
      }
    },
  }
}

/**
 * Resolve an entity reference to a Resource.
 * Tries exact match first (id / entityType / apiSlug), then falls back to
 * case-insensitive match on apiSlug / label / plural, with naive singular-
 * plural normalization (trailing 's').
 */
type EntityResolution =
  | { kind: 'exact'; resource: Resource }
  | { kind: 'normalized'; resource: Resource }
  | { kind: 'ambiguous'; candidates: string[] }
  | { kind: 'not_found' }

async function resolveEntity(orgId: string, key: string): Promise<EntityResolution> {
  const exact = await findCachedResource(orgId, key)
  if (exact) return { kind: 'exact', resource: exact }

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

  if (matches.length === 1) return { kind: 'normalized', resource: matches[0]! }
  if (matches.length > 1) {
    return { kind: 'ambiguous', candidates: matches.map((r) => r.apiSlug) }
  }
  return { kind: 'not_found' }
}

/**
 * Validate filters against the resource's fields and the operator catalog
 * before they reach SQL generation.
 *
 * Every rejected filter produces a warning with an actionable hint so the LLM
 * can self-correct in one turn. Valid filters pass through unchanged.
 */
function validateFilters(
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

/**
 * Convert simplified AI filters to ConditionGroup format.
 */
function convertToConditionGroup(
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
function resolveFieldId(field: string, resource: Resource): ResourceFieldId | ResourceFieldId[] {
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

/**
 * Extracts useful field values to include inline in query results, reducing
 * the need for follow-up get_entity calls.
 *
 * Every filtered field is always included (no cap) so the LLM can see the
 * field it just filtered on. Status/stage and createdAt are added as extras
 * up to a small cap to keep tokens reasonable.
 *
 * Filter fields can legitimately be absent from `data` (e.g. `operator: empty`
 * on a field that has no value), so we surface them as `null` rather than
 * silently dropping — otherwise the LLM can't tell the filter hit.
 */
function extractKeyFields(
  data: Record<string, unknown>,
  resource: Resource,
  filters: SimplifiedFilter[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const MAX_EXTRAS = 5
  let extras = 0

  // 1. ALWAYS include every filtered field, even if the stored value is null.
  const filterFieldKeys = new Set(filters.map((f) => f.field.split('.')[0]))
  for (const key of filterFieldKeys) {
    const field = resource.fields.find((f) => (f.systemAttribute ?? f.key) === key)
    const label = field?.label ?? key
    result[label] = data[key] ?? null
  }

  // 2. Status/stage field (commonly useful)
  const statusField = resource.fields.find(
    (f) => f.systemAttribute === 'status' || f.key === 'status' || f.key === 'stage'
  )
  if (
    extras < MAX_EXTRAS &&
    statusField &&
    !filterFieldKeys.has(statusField.systemAttribute ?? statusField.key)
  ) {
    const value = data[statusField.systemAttribute ?? statusField.key]
    if (value != null) {
      result[statusField.label] = value
      extras++
    }
  }

  // 3. createdAt (always useful for context)
  if (extras < MAX_EXTRAS && data.createdAt) {
    result.createdAt = data.createdAt
  }

  return result
}
