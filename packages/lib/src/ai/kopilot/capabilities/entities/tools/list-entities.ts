// packages/lib/src/ai/kopilot/capabilities/entities/tools/list-entities.ts

import { getCachedResources } from '../../../../../cache/org-cache-helpers'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'

export function createListEntitiesTool(_getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'list_entities',
    description:
      'List available entity types in this workspace (contacts, tickets, companies, custom entities, etc.). Call this first to discover what entity types exist before searching or modifying records.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Optional filter by name (case-insensitive match on label, plural, or apiSlug)',
        },
      },
      additionalProperties: false,
    },
    execute: async (_args, agentDeps) => {
      const query = (_args.query as string | undefined)?.toLowerCase()

      let resources = await getCachedResources(agentDeps.organizationId)

      // Filter out hidden resources
      resources = resources.filter((r) => r.isVisible !== false)

      // Filter by query if provided
      if (query) {
        resources = resources.filter(
          (r) =>
            r.label.toLowerCase().includes(query) ||
            r.plural.toLowerCase().includes(query) ||
            r.apiSlug.toLowerCase().includes(query)
        )
      }

      const entities = resources.map((r) => ({
        id: r.entityDefinitionId ?? r.id,
        apiSlug: r.apiSlug,
        label: r.label,
        plural: r.plural,
        entityType: r.entityType ?? null,
        icon: r.icon,
        color: r.color,
      }))

      return {
        success: true,
        output: { entities, count: entities.length },
      }
    },
  }
}
