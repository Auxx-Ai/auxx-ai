// packages/lib/src/ai/kopilot/capabilities/entities/tools/update-entity.ts

import { findCachedResource } from '../../../../../cache/org-cache-helpers'
import { UnifiedCrudHandler } from '../../../../../resources/crud'
import { getDefinitionId, isRecordId } from '../../../../../resources/resource-id'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { UpdateEntityDigest } from '../../../digests'
import type { GetToolDeps } from '../../types'
import {
  formatUnknownFieldsError,
  resolveFieldLabels,
  validateFieldKeys,
} from './field-label-helpers'
import { formatActorResolutionError, resolveActorValues } from './resolve-actor-values'

export function createUpdateEntityTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'update_entity',
    outputDigestSchema: UpdateEntityDigest,
    buildDigest: (output) => {
      const out = (output ?? {}) as { recordId?: string; updatedFields?: string[] }
      return {
        recordId: String(out.recordId ?? ''),
        updatedFields: Array.isArray(out.updatedFields) ? out.updatedFields : [],
      }
    },
    description: `Update field values on an entity instance.

REQUIRED BEFORE CALLING: If you have NOT already called \`list_entity_fields\` for this
entity's type in the current turn, call it first. Do NOT guess field ids from prior
turns, system prompt, or intuition — always use the exact \`id\` returned by the most
recent list_entity_fields call.

Each key in \`values\` must be an id from list_entity_fields. Unknown keys are rejected.
Do NOT include ids flagged \`readOnly: true\` or \`createOnly: true\` — the backend ignores
them on update. Ids listed in \`autoFilled\` are also system-managed; don't pass them.

Example (ids match list_entity_fields output):
  recordId: "abc123:def456"
  values: { "company_website": "https://new-site.com" }`,
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
            'Object mapping field IDs to their new values. Keys MUST be exact ids from the most recent list_entity_fields call (usually systemAttribute, e.g. company_website, ticket_status). Only include fields you want to update.',
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

      const resource = await findCachedResource(agentDeps.organizationId, getDefinitionId(recordId))

      if (resource) {
        const { unknownKeys, validIds } = validateFieldKeys(Object.keys(values), resource)
        if (unknownKeys.length > 0) {
          return {
            success: false,
            output: null,
            error: formatUnknownFieldsError(unknownKeys, validIds, resource.label),
          }
        }
      }

      let resolvedValues = values
      if (resource) {
        const actorResolution = await resolveActorValues(values, resource, {
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
        resolvedValues = actorResolution.values
      }

      const handler = new UnifiedCrudHandler(agentDeps.organizationId, agentDeps.userId, db)

      try {
        await handler.update(recordId, resolvedValues)
        const fieldIds = Object.keys(resolvedValues)
        const labels = resolveFieldLabels(resource, fieldIds)
        return {
          success: true,
          output: { recordId, updatedFields: labels },
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
