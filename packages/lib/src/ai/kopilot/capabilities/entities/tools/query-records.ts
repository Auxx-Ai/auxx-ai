// packages/lib/src/ai/kopilot/capabilities/entities/tools/query-records.ts

import { z } from 'zod'
import {
  countEntityInstances,
  countSystemResource,
  isSystemResource,
  UnifiedCrudHandler,
} from '../../../../../resources/crud'
import type { TableId } from '../../../../../resources/registry/field-registry'
import type { ResourceField } from '../../../../../resources/registry/field-types'
import type { Resource } from '../../../../../resources/registry/types'
import { toRecordId } from '../../../../../resources/resource-id'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { takeSample } from '../../../digests'
import type { GetToolDeps } from '../../types'
import { blockedEntityError } from '../shared/ai-entity-visibility'
import {
  assertCountFiltersApplied,
  convertToConditionGroup,
  type QueryWarning,
  QueryWarningSchema,
  resolveEntity,
  type SimplifiedFilter,
  validateFilters,
} from '../shared/record-filters'

/**
 * Full success output of `query_records`. Two shapes:
 * countOnly mode returns `{ entityType, total_matching, warnings? }`;
 * full mode adds `items`, `returned_count`, and `hasMore`. Each item carries
 * `recordId`/`displayName` plus dynamic label-keyed field values from the
 * matched record (and an unknown-record fallback that only has recordId +
 * displayName).
 */
const QueryRecordsOutput = z.object({
  entityType: z.string(),
  total_matching: z.number(),
  returned_count: z.number().optional(),
  hasMore: z.boolean().optional(),
  warnings: z.array(QueryWarningSchema).optional(),
  items: z
    .array(
      z
        .object({
          recordId: z.string(),
          displayName: z.string(),
          secondaryInfo: z.string().nullable().optional(),
        })
        .catchall(z.unknown())
    )
    .optional(),
})

export function createQueryRecordsTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'query_records',
    permission: {
      target: 'definition',
      level: 'view',
      enforcement: 'enforced',
      note: 'canViewEntity before the query; an unviewable def reads as empty.',
    },
    displayName: 'Filter records',
    toolsetSlug: 'auxx:entities:search',
    category: 'system',
    idempotent: true,
    outputSchema: QueryRecordsOutput,
    exampleOutput: {
      entityType: 'Contact',
      items: [
        {
          recordId: 'contact:9aB3xY',
          displayName: 'Jane Cooper',
          secondaryInfo: 'jane@example.com',
          Status: 'ACTIVE',
          createdAt: '2026-01-12T08:30:00.000Z',
        },
        {
          recordId: 'contact:4dF7mN',
          displayName: 'Alex Morgan',
          secondaryInfo: 'alex@acme.com',
          Status: 'ACTIVE',
          createdAt: '2026-02-03T11:45:00.000Z',
        },
      ],
      returned_count: 2,
      total_matching: 2,
      hasMore: false,
    } satisfies z.output<typeof QueryRecordsOutput>,
    buildDigest: (output) => {
      const out = (output ?? {}) as {
        items?: Array<Record<string, unknown>>
        total_matching?: number
        returned_count?: number
      }
      const items = Array.isArray(out.items) ? out.items : []
      const count =
        typeof out.total_matching === 'number'
          ? out.total_matching
          : typeof out.returned_count === 'number'
            ? out.returned_count
            : items.length
      return {
        count,
        sample: takeSample(items).map((item) => {
          const recordId = String(item.recordId ?? '')
          return {
            recordId,
            entityDefinitionId: recordId.split(':')[0] ?? '',
            displayName: typeof item.displayName === 'string' ? item.displayName : '',
            secondary: typeof item.secondaryInfo === 'string' ? item.secondaryInfo : undefined,
          }
        }),
      }
    },
    usageNotes:
      'Inspect `warnings[]` before trusting the result — each entry means a filter was rejected and dropped. `returned_count` is items in this page, `total_matching` is the full count.',
    description: `Query entity records with field-level filters, sorting, and pagination.
Use list_entity_fields first to discover available fields and their valid option values.
Email threads and messages are NOT record types here — this tool rejects them. Use find_threads / get_thread_detail instead.

Response shape:
- returned_count: number of items in this page
- total_matching: total records that match the filters
- warnings[]: present only when a filter was dropped (unknown field/operator, invalid option value, etc.). Read the hint and retry with the fix.
- countOnly: if NONE of your filters could be applied the tool errors instead of returning the unfiltered total; if only some were dropped you get the count plus a warning per ignored filter.

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
            'Entity type to query — pass the apiSlug from the entity catalog (e.g. "contact", "ticket").',
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
      const { db, capabilities } = getDeps()
      const key = args.entity as string
      const filters = (args.filters as SimplifiedFilter[]) ?? []
      const logicalOperator = (args.logicalOperator as 'AND' | 'OR') ?? 'AND'
      const sort = args.sort as { field: string; direction: 'asc' | 'desc' } | undefined
      const countOnly = args.countOnly === true
      const limit = Math.min((args.limit as number) || 25, 100)
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
      // Threads/messages carry a per-member lens that exists only in the mail
      // query layer; this path applies none, so it refuses rather than answering.
      if (resolution.kind === 'blocked') {
        return { success: false, output: null, error: blockedEntityError(key) }
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

      // Read enforcement (§3): a def the member can't view returns nothing.
      if (capabilities && !capabilities.canViewEntity(entityDefId)) {
        return {
          success: true,
          output: {
            entityType: resource.label,
            items: [],
            returned_count: 0,
            total_matching: 0,
            hasMore: false,
            warnings: warnings.length > 0 ? warnings : undefined,
          },
        }
      }
      const handler = new UnifiedCrudHandler(
        agentDeps.organizationId,
        agentDeps.userId,
        db,
        undefined,
        {
          capabilities,
        }
      )

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
      const conditionGroups = conditionGroup ? [conditionGroup] : []

      // Count-only mode — short-circuit: run just `SELECT COUNT(*)`, skip id fetch + hydration.
      if (countOnly) {
        const counted = isSystemResource(entityDefId)
          ? await countSystemResource({
              db,
              tableId: entityDefId as TableId,
              organizationId: agentDeps.organizationId,
              filters: conditionGroups,
            })
          : await countEntityInstances({
              db,
              entityDefinitionId: entityDefId,
              organizationId: agentDeps.organizationId,
              filters: conditionGroups,
            })

        // The query lane fails OPEN and reports; this boundary refuses when
        // nothing survived — "6,470" for "how many open tickets" is worse than
        // an error, because the model states it as fact. A partial drop still
        // answers, with one warning per ignored condition. `assertCountFiltersApplied`
        // throws an `AuxxError`; the tool's own idiom for a refusal the caller
        // caused is `success: false`, same as the branches above, so it is
        // translated rather than allowed to surface as a thrown tool.
        try {
          warnings.push(...assertCountFiltersApplied(counted, resource.label))
        } catch (error) {
          return {
            success: false,
            output: { warnings },
            error: error instanceof Error ? error.message : String(error),
          }
        }

        return {
          success: true,
          output: {
            entityType: resource.label,
            total_matching: counted.count,
            warnings: warnings.length > 0 ? warnings : undefined,
          },
        }
      }

      // Build sorting
      const sorting = sort ? [{ id: sort.field, desc: sort.direction === 'desc' }] : []

      // `includeTotal` is forced: this tool exposes `offset` for paging and its output
      // schema requires `total_matching`, so it needs the COUNT on deep pages too — the
      // default (first page only) would report `undefined` from page 2 on.
      const filtered = await handler.listFiltered({
        entityDefinitionId: entityDefId,
        filters: conditionGroups,
        sorting,
        limit,
        offset,
        includeTotal: true,
      })

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
          total_matching: filtered.total ?? items.length,
          hasMore: filtered.hasMore,
          warnings: warnings.length > 0 ? warnings : undefined,
        },
      }
    },
  }
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
  const filterFieldKeys = new Set(
    filters.map((f) => f.field.split('.')[0]).filter((k): k is string => Boolean(k))
  )
  for (const key of filterFieldKeys) {
    const field = resource.fields.find((f) => f.systemAttribute === key || f.key === key)
    result[field?.label ?? key] = readRowValue(data, field, key) ?? null
  }

  // 2. Status/stage field (commonly useful)
  const statusField = resource.fields.find((f) => f.key === 'status' || f.key === 'stage')
  if (
    extras < MAX_EXTRAS &&
    statusField &&
    !filterFieldKeys.has(statusField.key) &&
    !(statusField.systemAttribute && filterFieldKeys.has(statusField.systemAttribute))
  ) {
    const value = readRowValue(data, statusField, statusField.key)
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

/**
 * Read one field's value out of a picker row.
 *
 * `RecordPickerItem.data` is the raw row, so a system resource is keyed by its
 * DB column / field `key` (`status`), never by the namespaced `systemAttribute`
 * (`ticket_status`). The LLM, meanwhile, may have named the field by either.
 * Try every alias the field carries rather than committing to one.
 */
function readRowValue(
  data: Record<string, unknown>,
  field: ResourceField | undefined,
  fallbackKey: string
): unknown {
  const aliases = field ? [field.systemAttribute, field.key, field.dbColumn] : [fallbackKey]
  for (const alias of aliases) {
    if (alias && data[alias] !== undefined) return data[alias]
  }
  return undefined
}
