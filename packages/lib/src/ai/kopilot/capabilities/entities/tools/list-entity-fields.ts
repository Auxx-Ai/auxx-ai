// packages/lib/src/ai/kopilot/capabilities/entities/tools/list-entity-fields.ts

import { findCachedResource } from '../../../../../cache/org-cache-helpers'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'

export function createListEntityFieldsTool(_getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'list_entity_fields',
    description:
      'List fields/attributes for an entity type. Use to discover field names before searching, filtering, sorting, or updating.',
    parameters: {
      type: 'object',
      properties: {
        entityDefinitionId: {
          type: 'string',
          description: 'Entity definition ID, apiSlug, or entityType (from list_entities result)',
        },
        query: {
          type: 'string',
          description: 'Optional filter by field name (case-insensitive)',
        },
      },
      required: ['entityDefinitionId'],
      additionalProperties: false,
    },
    execute: async (args, agentDeps) => {
      const key = args.entityDefinitionId as string
      const query = (args.query as string | undefined)?.toLowerCase()

      const resource = await findCachedResource(agentDeps.organizationId, key)
      if (!resource) {
        return {
          success: false,
          output: null,
          error: `Entity type "${key}" not found. Call list_entities to discover available entity types.`,
        }
      }

      let fields = resource.fields

      // Filter by query if provided
      if (query) {
        fields = fields.filter(
          (f) =>
            f.label.toLowerCase().includes(query) ||
            (f.systemAttribute?.toLowerCase().includes(query) ?? false) ||
            f.key.toLowerCase().includes(query)
        )
      }

      const output = fields.map((f) => ({
        id: f.systemAttribute ?? f.key,
        label: f.label,
        fieldType: f.fieldType ?? f.type,
        capabilities: f.capabilities,
        systemAttribute: f.systemAttribute ?? null,
      }))

      return {
        success: true,
        output: { entityDefinitionId: resource.entityDefinitionId ?? resource.id, fields: output },
      }
    },
  }
}
