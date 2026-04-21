// packages/lib/src/ai/kopilot/capabilities/entities/tools/bulk-update-entity.ts

import { findCachedResource } from '../../../../../cache/org-cache-helpers'
import { FieldValueService } from '../../../../../field-values/field-value-service'
import { getDefinitionId, isRecordId } from '../../../../../resources/resource-id'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import {
  formatUnknownFieldsError,
  resolveFieldLabels,
  validateFieldKeys,
} from './field-label-helpers'
import { formatActorResolutionError, resolveActorValuesFlat } from './resolve-actor-values'

export function createBulkUpdateEntityTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'bulk_update_entity',
    usageNotes: 'Emits an `action-result` block automatically.',
    description: `Update the same field values on multiple entity instances at once. All records must be the same entity type.

REQUIRED BEFORE CALLING: If you have NOT already called \`list_entity_fields\` for this
entity's type in the current turn, call it first. Do NOT guess field ids from prior
turns, system prompt, or intuition — always use the exact \`id\` returned by the most
recent list_entity_fields call.

Each \`fieldId\` must be an id from list_entity_fields. Unknown ids are rejected.
Do NOT include ids flagged \`readOnly: true\` or \`createOnly: true\` — the backend ignores
them on update. Ids listed in \`autoFilled\` are also system-managed; don't pass them.

Use this tool instead of update_entity when updating 2+ records with the same field values.

Example (ids match list_entity_fields output):
  recordIds: ["abc123:def456", "abc123:ghi789"]
  values: [{ "fieldId": "ticket_status", "value": "COMPLETED" }]`,
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
                description:
                  'Exact `id` from the most recent list_entity_fields call (usually systemAttribute, e.g. ticket_status, company_website). Unknown ids are rejected.',
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

      const firstRecordId = recordIds[0] as string
      const resource = await findCachedResource(
        agentDeps.organizationId,
        getDefinitionId(firstRecordId)
      )

      if (resource) {
        const { unknownKeys, validIds } = validateFieldKeys(
          values.map((v) => v.fieldId),
          resource
        )
        if (unknownKeys.length > 0) {
          return {
            success: false,
            output: null,
            error: formatUnknownFieldsError(unknownKeys, validIds, resource.label),
          }
        }
      }

      let resolvedPairs = values.map((v) => ({ fieldId: v.fieldId, value: v.value ?? null }))
      if (resource) {
        const actorResolution = await resolveActorValuesFlat(resolvedPairs, resource, {
          organizationId: agentDeps.organizationId,
          userId: agentDeps.userId,
        })
        if (actorResolution.errors.length > 0) {
          return {
            success: false,
            output: null,
            error: formatActorResolutionError(actorResolution.errors, agentDeps.userId),
          }
        }
        resolvedPairs = actorResolution.pairs.map((p) => ({
          fieldId: p.fieldId,
          value: p.value ?? null,
        }))
      }

      const service = new FieldValueService(agentDeps.organizationId, agentDeps.userId, db)

      try {
        const result = await service.setBulkValues({
          recordIds: recordIds as `${string}:${string}`[],
          values: resolvedPairs,
        })

        const fieldIds = resolvedPairs.map((v) => v.fieldId)
        const fieldLabels = resolveFieldLabels(resource, fieldIds)
        return {
          success: true,
          output: {
            total: allRecordIds.length,
            approved: recordIds.length,
            updated: result.count,
            updatedFields: fieldLabels,
          },
          blocks: [
            {
              type: 'action-result',
              data: {
                action: 'bulk_update_entity',
                success: true,
                summary: `Updated ${result.count} record${result.count === 1 ? '' : 's'} (${fieldLabels.join(', ')})`,
                recordIds,
                count: result.count,
              },
            },
          ],
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
