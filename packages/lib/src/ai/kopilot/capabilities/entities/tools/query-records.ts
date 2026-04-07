// packages/lib/src/ai/kopilot/capabilities/entities/tools/query-records.ts

import type { ResourceFieldId } from '@auxx/types/field'
import { toResourceFieldId } from '@auxx/types/field'
import { findCachedResource } from '../../../../../cache/org-cache-helpers'
import type { Condition, ConditionGroup } from '../../../../../conditions'
import { UnifiedCrudHandler } from '../../../../../resources/crud'
import type { Resource } from '../../../../../resources/registry/types'
import { toRecordId } from '../../../../../resources/resource-id'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'

interface SimplifiedFilter {
  field: string
  operator: string
  value?: unknown
}

export function createQueryRecordsTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'query_records',
    description: `Query entity records with field-level filters, sorting, and pagination.
Use list_entity_fields first to discover available fields and their valid values.

Examples:
- All active contacts: { entity: "contact", filters: [{ field: "status", operator: "is", value: "ACTIVE" }] }
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

      // Resolve entity definition
      const resource = await findCachedResource(agentDeps.organizationId, key)
      if (!resource) {
        return {
          success: false,
          output: null,
          error: `Entity type "${key}" not found. Check the entity catalog in your system prompt for available types.`,
        }
      }

      const entityDefId = resource.entityDefinitionId ?? resource.id
      const handler = new UnifiedCrudHandler(agentDeps.organizationId, agentDeps.userId, db)

      // Convert simplified filters → ConditionGroup[]
      const conditionGroup = convertToConditionGroup(filters, resource, logicalOperator)

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
            total: filtered.total,
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
          ...extractKeyFields(record.data, resource, filters),
        }
      })

      return {
        success: true,
        output: {
          entityType: resource.label,
          items,
          count: items.length,
          total: filtered.total,
          hasMore: filtered.hasMore,
        },
      }
    },
  }
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
 * Extracts useful field values to include inline in query results,
 * reducing the need for follow-up get_entity calls.
 * Cap: 5 fields max to keep token count reasonable.
 */
function extractKeyFields(
  data: Record<string, unknown>,
  resource: Resource,
  filters: SimplifiedFilter[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const MAX_FIELDS = 5
  let count = 0

  // 1. Fields referenced in filters (the user cares about these)
  const filterFieldKeys = new Set(filters.map((f) => f.field.split('.')[0]))
  for (const key of filterFieldKeys) {
    if (count >= MAX_FIELDS) break
    const value = data[key]
    if (value != null) {
      const field = resource.fields.find((f) => (f.systemAttribute ?? f.key) === key)
      result[field?.label ?? key] = value
      count++
    }
  }

  // 2. Status/stage fields (commonly useful)
  if (count < MAX_FIELDS) {
    const statusField = resource.fields.find(
      (f) => f.systemAttribute === 'status' || f.key === 'status' || f.key === 'stage'
    )
    if (statusField && !filterFieldKeys.has(statusField.systemAttribute ?? statusField.key)) {
      const value = data[statusField.systemAttribute ?? statusField.key]
      if (value != null) {
        result[statusField.label] = value
        count++
      }
    }
  }

  // 3. createdAt (always useful for context)
  if (count < MAX_FIELDS && data.createdAt) {
    result.createdAt = data.createdAt
  }

  return result
}
