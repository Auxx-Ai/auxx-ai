// packages/lib/src/ai/kopilot/capabilities/entities/tools/create-entity.ts

import { findCachedResource } from '../../../../../cache/org-cache-helpers'
import { UnifiedCrudHandler } from '../../../../../resources/crud'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'

export function createCreateEntityTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'create_entity',
    description: `Create a new entity instance. Requires user approval before execution.

IMPORTANT: You MUST call list_entity_fields first to discover valid field IDs.
Pass field values inside the "values" object using the field IDs returned by list_entity_fields.

Example:
  entityDefinitionId: "abc123"
  values: { "companyName": "Acme", "website": "https://acme.com" }`,
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
          description:
            'Object mapping field IDs to their values. Field IDs come from list_entity_fields (e.g. { "companyName": "Acme", "website": "https://acme.com" }). Only include fields you want to set.',
          additionalProperties: true,
        },
      },
      required: ['entityDefinitionId', 'values'],
      additionalProperties: false,
    },
    execute: async (args, agentDeps) => {
      const { db } = getDeps()
      const key = args.entityDefinitionId as string

      // The LLM may nest field values under `values` or flatten them at the top level.
      const values =
        (args.values as Record<string, unknown>) ??
        Object.fromEntries(
          Object.entries(args).filter(([k]) => k !== 'entityDefinitionId' && k !== 'values')
        )

      if (!values || Object.keys(values).length === 0) {
        return {
          success: false,
          output: null,
          error:
            'No field values provided. Call list_entity_fields first to discover fields, then pass them in the "values" object.',
        }
      }

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
