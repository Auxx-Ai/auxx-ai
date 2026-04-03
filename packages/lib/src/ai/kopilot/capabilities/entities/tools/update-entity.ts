// packages/lib/src/ai/kopilot/capabilities/entities/tools/update-entity.ts

import { UnifiedCrudHandler } from '../../../../../resources/crud'
import { isRecordId } from '../../../../../resources/resource-id'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'

export function createUpdateEntityTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'update_entity',
    description:
      'Update field values on an entity instance. Requires user approval before execution.',
    requiresApproval: true,
    parameters: {
      type: 'object',
      properties: {
        recordId: {
          type: 'string',
          description: 'Record ID (format: entityDefinitionId:entityInstanceId)',
        },
        values: {
          type: 'object',
          description: 'Field ID → new value mapping. Use field IDs from list_entity_fields.',
        },
      },
      required: ['recordId', 'values'],
      additionalProperties: false,
    },
    execute: async (args, agentDeps) => {
      const { db } = getDeps()
      const recordId = args.recordId as string
      const values = args.values as Record<string, unknown>

      if (!isRecordId(recordId)) {
        return {
          success: false,
          output: null,
          error: `Invalid recordId format "${recordId}". Expected "entityDefinitionId:entityInstanceId".`,
        }
      }

      const handler = new UnifiedCrudHandler(agentDeps.organizationId, agentDeps.userId, db)

      try {
        await handler.update(recordId, values)
        return {
          success: true,
          output: { recordId, updatedFields: Object.keys(values) },
        }
      } catch (err) {
        return {
          success: false,
          output: null,
          error: err instanceof Error ? err.message : 'Failed to update entity',
        }
      }
    },
  }
}
