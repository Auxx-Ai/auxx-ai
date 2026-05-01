// packages/lib/src/ai/kopilot/capabilities/entities/tools/search-entities.ts

import type { RecordId } from '@auxx/types/resource'
import { findCachedResource, getCachedResources } from '../../../../../cache/org-cache-helpers'
import { RecordPickerService } from '../../../../../resources/picker'
import { parseRecordId } from '../../../../../resources/resource-id'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { SearchEntitiesDigest, takeSample } from '../../../digests'
import type { GetToolDeps } from '../../types'
import { enrichEntitiesWithFieldValues } from '../enrich-entity-fields'
import { formatEnrichedFields } from '../format-enriched-fields'

const MAX_RESULTS = 25

export function createSearchEntitiesTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'search_entities',
    idempotent: true,
    outputBlock: 'entity-list',
    outputDigestSchema: SearchEntitiesDigest,
    buildDigest: (output) => {
      const out = (output ?? {}) as {
        items?: Array<Record<string, unknown>>
        count?: number
      }
      const items = Array.isArray(out.items) ? out.items : []
      return {
        count: typeof out.count === 'number' ? out.count : items.length,
        sample: takeSample(items).map((item) => {
          const recordId = String(item.recordId ?? '')
          const entityDefinitionId = recordId.split(':')[0] ?? ''
          return {
            recordId,
            entityDefinitionId,
            displayName: typeof item.displayName === 'string' ? item.displayName : '',
            secondary: typeof item.secondaryInfo === 'string' ? item.secondaryInfo : undefined,
          }
        }),
      }
    },
    usageNotes:
      'For field-value comparisons, follow up with `get_entity` per record — this tool only enriches fields when matches ≤5. When you reach `submit_final_answer`, embed the records you are referring to in an `auxx:entity-card` (1) or `auxx:entity-list` (2+) fence inside `content`. Records mentioned in prose without a fence will not be visible to the user.',
    description:
      'Search for records by name or text across all entity types, or within a specific entity type. Returns matching records with display names. If you know the entity type, pass entityDefinitionId for faster results.',
    parameters: {
      type: 'object',
      properties: {
        entityDefinitionId: {
          type: 'string',
          description:
            'Optional. Entity type — pass the apiSlug from the entity catalog (e.g. "contact", "company"). Omit to search across ALL entity types.',
        },
        query: {
          type: 'string',
          description: 'Text search query (name, email, etc.)',
        },
        limit: {
          type: 'number',
          description: `Max results (default 10, max ${MAX_RESULTS})`,
        },
      },
      required: [],
      additionalProperties: false,
    },
    execute: async (args, agentDeps) => {
      const { db } = getDeps()
      const key = args.entityDefinitionId as string | undefined
      const query = args.query as string | undefined
      const limit = Math.min((args.limit as number) || 10, MAX_RESULTS)

      const pickerService = new RecordPickerService(agentDeps.organizationId, agentDeps.userId, db)

      // Build entity type label lookup for cross-type search results
      const allResources = await getCachedResources(agentDeps.organizationId)
      const entityLabelByDefId = new Map(
        allResources.map((r) => [r.entityDefinitionId ?? r.id, r.label])
      )

      let searchParams: {
        query: string
        entityDefinitionId?: string
        entityDefinitionIds?: string[]
        limit: number
      }

      if (key) {
        // Scoped search — single entity type
        const resource = await findCachedResource(agentDeps.organizationId, key)
        if (!resource) {
          const validSlugs = allResources.map((r) => r.apiSlug).join(', ')
          return {
            success: false,
            output: null,
            error: `Entity type "${key}" not found. Use one of these apiSlugs: ${validSlugs}.`,
          }
        }
        searchParams = {
          query: query ?? '',
          entityDefinitionId: resource.entityDefinitionId ?? resource.id,
          limit,
        }
      } else {
        // Global search — all visible entity types
        const visibleDefIds = allResources
          .filter((r) => r.isVisible !== false)
          .map((r) => r.entityDefinitionId ?? r.id)

        searchParams = {
          query: query ?? '',
          entityDefinitionIds: visibleDefIds,
          limit,
        }
      }

      const result = await pickerService.search(searchParams)

      const items = result.items.map((item) => {
        // Extract entityDefinitionId from recordId (format: "entityDefId:instanceId")
        const entityDefId = String(item.recordId).split(':')[0]
        return {
          recordId: item.recordId,
          displayName: item.displayName,
          entityType: entityDefId ? (entityLabelByDefId.get(entityDefId) ?? null) : null,
          secondaryInfo: item.secondaryInfo ?? null,
        }
      })

      if (items.length === 0) {
        return {
          success: true,
          output: {
            items: [],
            count: 0,
            suggestion: query
              ? `No records found for "${query}". Try a shorter or different search term, or use query_records with specific field filters.`
              : 'No records found. Try providing a search query.',
          },
        }
      }

      // Auto-enrich with full entity data + custom field values for small result sets
      // to avoid the LLM needing to copy opaque recordIds into separate get_entity calls
      const AUTO_ENRICH_THRESHOLD = 5
      if (items.length <= AUTO_ENRICH_THRESHOLD) {
        const recordIds = items.map((item) => item.recordId) as RecordId[]
        const detailed = await pickerService.getResourcesByIds(recordIds)

        // Enrich with custom field values
        const entities = recordIds.map((rid) => {
          const { entityDefinitionId, entityInstanceId } = parseRecordId(rid)
          return { recordId: String(rid), entityDefinitionId, entityInstanceId }
        })
        const enrichedFields = await enrichEntitiesWithFieldValues({
          organizationId: agentDeps.organizationId,
          userId: agentDeps.userId,
          db,
          entities,
        })

        const enrichedItems = items.map((item) => {
          const detail = detailed[item.recordId as RecordId]
          const fields = formatEnrichedFields(enrichedFields.get(item.recordId) ?? {})
          return {
            ...item,
            fields,
            createdAt: detail?.createdAt,
            updatedAt: detail?.updatedAt,
          }
        })
        return {
          success: true,
          output: { items: enrichedItems, count: enrichedItems.length },
        }
      }

      return {
        success: true,
        output: { items, count: items.length },
      }
    },
  }
}
