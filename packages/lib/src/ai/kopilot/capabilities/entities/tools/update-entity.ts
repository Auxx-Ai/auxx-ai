// packages/lib/src/ai/kopilot/capabilities/entities/tools/update-entity.ts

import { UnifiedCrudHandler } from '../../../../../resources/crud'
import { isRecordId } from '../../../../../resources/resource-id'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'

export function createUpdateEntityTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'update_entity',
    usageNotes: 'Emits an `action-result` block automatically.',
    description: `Update field values on an entity instance.

IMPORTANT: You MUST call list_entity_fields first to discover valid field IDs.
Pass field values inside the "values" object using the field IDs returned by list_entity_fields.

Example:
  recordId: "abc123:def456"
  values: { "website": "https://new-site.com" }`,
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
          description:
            'Object mapping field IDs to their new values. Field IDs come from list_entity_fields (e.g. { "website": "https://new-site.com" }). Only include fields you want to update.',
          additionalProperties: true,
        },
      },
      required: ['recordId', 'values'],
      additionalProperties: false,
    },
    execute: async (args, agentDeps) => {
      const { db } = getDeps()
      const recordId = args.recordId as string

      // The LLM may nest field values under `values` or flatten them at the top level.
      const values =
        (args.values as Record<string, unknown>) ??
        Object.fromEntries(Object.entries(args).filter(([k]) => k !== 'recordId' && k !== 'values'))

      if (!isRecordId(recordId)) {
        return {
          success: false,
          output: null,
          error: `Invalid recordId format "${recordId}". Expected "entityDefinitionId:entityInstanceId".`,
        }
      }

      if (!values || Object.keys(values).length === 0) {
        return {
          success: false,
          output: null,
          error:
            'No field values provided. Call list_entity_fields first to discover fields, then pass them in the "values" object.',
        }
      }

      const handler = new UnifiedCrudHandler(agentDeps.organizationId, agentDeps.userId, db)

      try {
        await handler.update(recordId, values)
        const fieldNames = Object.keys(values)
        const summary =
          fieldNames.length === 1
            ? `Updated ${fieldNames[0]}`
            : `Updated ${fieldNames.length} fields`
        return {
          success: true,
          output: { recordId, updatedFields: fieldNames },
          blocks: [
            {
              type: 'action-result',
              data: {
                action: 'update_entity',
                success: true,
                summary,
                recordId,
                count: fieldNames.length,
              },
            },
          ],
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
