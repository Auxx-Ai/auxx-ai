// packages/lib/src/ai/kopilot/capabilities/entities/tools/bulk-update-entity.ts

import { FieldValueService } from '../../../../../field-values/field-value-service'
import { isRecordId } from '../../../../../resources/resource-id'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'

export function createBulkUpdateEntityTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'bulk_update_entity',
    description: `Update the same field values on multiple entity instances at once. All records must be the same entity type.

APPROVAL: The platform automatically pauses and shows an approval card to the user when you call this tool. You do NOT ask the user in text — just call the tool with correct args. The user approves or rejects via the card.

IMPORTANT: You MUST call list_entity_fields first to discover valid field IDs.
Use this tool instead of update_entity when updating 2+ records with the same field values.

Example:
  recordIds: ["abc123:def456", "abc123:ghi789"]
  values: [{ "fieldId": "status", "value": "COMPLETED" }]`,
    requiresApproval: true,
    parameters: {
      type: 'object',
      properties: {
        recordIds: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Array of record IDs to update (format: entityDefinitionId:entityInstanceId)',
        },
        values: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              fieldId: {
                type: 'string',
                description: 'Field ID from list_entity_fields (e.g. "status", "priority")',
              },
              value: {
                description: 'The new value for the field (null to clear)',
              },
            },
            required: ['fieldId', 'value'],
          },
          description: 'Array of field values to set on all records.',
        },
      },
      required: ['recordIds', 'values'],
      additionalProperties: false,
    },
    execute: async (args, agentDeps) => {
      const { db } = getDeps()
      const allRecordIds = args.recordIds as string[]
      const values = args.values as Array<{ fieldId: string; value: unknown }>

      // inputAmendment._approvedRecordIds filters which records to actually update
      const approvedIds = args._approvedRecordIds as string[] | undefined
      const recordIds = approvedIds
        ? allRecordIds.filter((id) => approvedIds.includes(id))
        : allRecordIds

      if (recordIds.length === 0) {
        return {
          success: false,
          output: null,
          error: 'No record IDs provided or none were approved.',
        }
      }

      const invalidIds = recordIds.filter((id) => !isRecordId(id))
      if (invalidIds.length > 0) {
        return {
          success: false,
          output: null,
          error: `Invalid recordId format: ${invalidIds.join(', ')}. Expected "entityDefinitionId:entityInstanceId".`,
        }
      }

      if (!values || values.length === 0) {
        return {
          success: false,
          output: null,
          error:
            'No field values provided. Call list_entity_fields first to discover fields, then pass them in the "values" array.',
        }
      }

      const service = new FieldValueService(agentDeps.organizationId, agentDeps.userId, db)

      try {
        const result = await service.setBulkValues({
          recordIds: recordIds as `${string}:${string}`[],
          values: values.map((v) => ({ fieldId: v.fieldId, value: v.value ?? null })),
        })

        return {
          success: true,
          output: {
            total: allRecordIds.length,
            approved: recordIds.length,
            updated: result.count,
            updatedFields: values.map((v) => v.fieldId),
          },
        }
      } catch (err) {
        return {
          success: false,
          output: null,
          error: err instanceof Error ? err.message : 'Failed to bulk update entities',
        }
      }
    },
  }
}
