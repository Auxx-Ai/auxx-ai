// packages/lib/src/ai/kopilot/capabilities/entities/tools/create-entity.ts

import { findCachedResource } from '../../../../../cache/org-cache-helpers'
import { UnifiedCrudHandler } from '../../../../../resources/crud'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'

export function createCreateEntityTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'create_entity',
    description:
      'Create a new entity instance with field values. Requires user approval before execution. Use list_entity_fields first to discover required fields.',
    requiresApproval: true,
    parameters: {
      type: 'object',
      properties: {
        entityDefinitionId: {
          type: 'string',
          description: 'Entity definition ID (from list_entities)',
        },
        values: {
          type: 'object',
          description: 'Field ID → value mapping. Use field IDs from list_entity_fields.',
        },
      },
      required: ['entityDefinitionId', 'values'],
      additionalProperties: false,
    },
    execute: async (args, agentDeps) => {
      const { db } = getDeps()
      const key = args.entityDefinitionId as string
      const values = args.values as Record<string, unknown>

      const resource = await findCachedResource(agentDeps.organizationId, key)
      if (!resource) {
        return {
          success: false,
          output: null,
          error: `Entity type "${key}" not found. Call list_entities to discover available entity types.`,
        }
      }

      const entityDefId = resource.entityDefinitionId ?? resource.id
      const handler = new UnifiedCrudHandler(agentDeps.organizationId, agentDeps.userId, db)

      try {
        const result = await handler.create(entityDefId, values)
        return {
          success: true,
          output: {
            recordId: result.recordId,
            displayName: result.values?.displayName ?? null,
          },
        }
      } catch (err) {
        return {
          success: false,
          output: null,
          error: err instanceof Error ? err.message : 'Failed to create entity',
        }
      }
    },
  }
}
