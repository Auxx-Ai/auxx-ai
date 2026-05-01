// packages/lib/src/ai/kopilot/capabilities/entities/tools/list-entities.ts

import { getCachedResources } from '../../../../../cache/org-cache-helpers'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { ListEntitiesDigest } from '../../../digests'
import type { GetToolDeps } from '../../types'

export function createListEntitiesTool(_getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'list_entities',
    idempotent: true,
    outputDigestSchema: ListEntitiesDigest,
    buildDigest: (output) => {
      const out = (output ?? {}) as { entities?: Array<{ apiSlug?: string; label?: string }> }
      return {
        entityTypes: Array.isArray(out.entities)
          ? out.entities.map((e) => e.label ?? e.apiSlug ?? '').filter(Boolean)
          : [],
      }
    },
    usageNotes:
      'Returns entity TYPES, not records. Use to discover what exists; then `query_records` or `search_entities` for actual records.',
    description:
      'Discover what entity TYPES exist in this workspace (e.g. Contact, Ticket, Company, custom entities). Returns type metadata, NOT individual records. Use search_entities to find specific records.',
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
