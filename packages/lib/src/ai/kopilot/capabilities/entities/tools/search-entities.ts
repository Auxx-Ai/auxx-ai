// packages/lib/src/ai/kopilot/capabilities/entities/tools/search-entities.ts

import { findCachedResource, getCachedResources } from '../../../../../cache/org-cache-helpers'
import { RecordPickerService } from '../../../../../resources/picker'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'

const MAX_RESULTS = 25

export function createSearchEntitiesTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'search_entities',
    description:
      'Search for records by name or text across all entity types, or within a specific entity type. Returns matching records with display names. If you know the entity type, pass entityDefinitionId for faster results.',
    parameters: {
      type: 'object',
      properties: {
        entityDefinitionId: {
          type: 'string',
          description:
            'Optional. Entity definition ID, apiSlug, or entityType. Omit to search across ALL entity types.',
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
          return {
            success: false,
            output: null,
            error: `Entity type "${key}" not found. Check the entity catalog in your system prompt for available types.`,
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

      return {
        success: true,
        output: { items, count: items.length },
      }
    },
  }
}
