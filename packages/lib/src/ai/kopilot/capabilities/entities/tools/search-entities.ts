// packages/lib/src/ai/kopilot/capabilities/entities/tools/search-entities.ts

import { findCachedResource } from '../../../../../cache/org-cache-helpers'
import { RecordPickerService } from '../../../../../resources/picker'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'

const MAX_RESULTS = 25

export function createSearchEntitiesTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'search_entities',
    description:
      'Search records of any entity type by query. Returns recordIds that the frontend can resolve to full display data. Use list_entities first to discover entity types.',
    parameters: {
      type: 'object',
      properties: {
        entityDefinitionId: {
          type: 'string',
          description: 'Entity definition ID, apiSlug, or entityType (from list_entities)',
        },
        query: {
          type: 'string',
          description: 'Text search query',
        },
        limit: {
          type: 'number',
          description: `Max results (default 10, max ${MAX_RESULTS})`,
        },
      },
      required: ['entityDefinitionId'],
      additionalProperties: false,
    },
    execute: async (args, agentDeps) => {
      const { db } = getDeps()
      const key = args.entityDefinitionId as string
      const query = args.query as string | undefined
      const limit = Math.min((args.limit as number) || 10, MAX_RESULTS)

      const resource = await findCachedResource(agentDeps.organizationId, key)
      if (!resource) {
        return {
          success: false,
          output: null,
          error: `Entity type "${key}" not found. Call list_entities to discover available entity types.`,
        }
      }

      const entityDefId = resource.entityDefinitionId ?? resource.id
      const pickerService = new RecordPickerService(agentDeps.organizationId, agentDeps.userId, db)

      const result = await pickerService.search({
        query: query ?? '',
        entityDefinitionId: entityDefId,
        limit,
      })

      const items = result.items.map((item) => ({
        recordId: item.recordId,
        displayName: item.displayName,
        secondaryInfo: item.secondaryInfo ?? null,
      }))

      return {
        success: true,
        output: { items, count: items.length },
      }
    },
  }
}
