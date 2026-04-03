// packages/lib/src/ai/kopilot/capabilities/entities/tools/get-entity.ts

import { RecordPickerService } from '../../../../../resources/picker'
import { isRecordId } from '../../../../../resources/resource-id'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'

export function createGetEntityTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'get_entity',
    description:
      'Get detailed information about a specific entity instance including all field values. Use when you need to read specific field data, not just display the record.',
    parameters: {
      type: 'object',
      properties: {
        recordId: {
          type: 'string',
          description: 'Record ID (format: entityDefinitionId:entityInstanceId)',
        },
      },
      required: ['recordId'],
      additionalProperties: false,
    },
    execute: async (args, agentDeps) => {
      const { db } = getDeps()
      const recordId = args.recordId as string

      if (!isRecordId(recordId)) {
        return {
          success: false,
          output: null,
          error: `Invalid recordId format "${recordId}". Expected "entityDefinitionId:entityInstanceId".`,
        }
      }

      const pickerService = new RecordPickerService(agentDeps.organizationId, agentDeps.userId, db)
      const items = await pickerService.getResourcesByIds([recordId])
      const item = items[recordId]

      if (!item) {
        return {
          success: false,
          output: null,
          error: `Record "${recordId}" not found.`,
        }
      }

      return {
        success: true,
        output: {
          recordId: item.recordId,
          displayName: item.displayName,
          secondaryInfo: item.secondaryInfo ?? null,
          avatarUrl: item.avatarUrl ?? null,
          data: item.data,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        },
      }
    },
  }
}
