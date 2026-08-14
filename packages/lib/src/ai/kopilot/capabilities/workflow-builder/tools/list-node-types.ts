// packages/lib/src/ai/kopilot/capabilities/workflow-builder/tools/list-node-types.ts

import { listManifests } from '../../../../../workflow-engine/catalog/registry'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'

/**
 * Compact node-type catalog — progressive disclosure (04 §1): this is the only
 * node list in the prompt path; `describe_node_type` carries the schemas.
 * Static product data, identical for every org, so no authorization gate.
 */
export function createListNodeTypesTool(getDeps: GetToolDeps): AgentToolDefinition {
  void getDeps
  return {
    name: 'list_node_types',
    permission: {
      target: 'none',
      note: 'Static node-type catalog (the registry manifest list) — identical for every org, no workspace data.',
    },
    displayName: 'List node types',
    surfaces: ['builder'],
    idempotent: true,
    description:
      'List or search workflow node types: id, display name, one-line description, category, whether it is a trigger, and whether you may author it. Call describe_node_type before configuring one.',
    parameters: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description:
            "Optional category filter (e.g. 'trigger', 'action', 'condition', 'flow_control', 'ai').",
        },
        query: {
          type: 'string',
          description:
            'Optional free-text search over type id, display name, description, and category.',
        },
      },
      additionalProperties: false,
    },
    buildDigest: (output) => {
      const out = (output ?? {}) as { types?: unknown[] }
      return {
        label: 'Node types listed',
        resultCount: Array.isArray(out.types) ? out.types.length : 0,
      }
    },
    execute: async (args) => {
      const category = typeof args.category === 'string' ? args.category : undefined
      const query = typeof args.query === 'string' ? args.query.trim() : ''
      const normalizedQuery = query.toLowerCase()
      const types = listManifests()
        .filter((m) => !category || m.category === category)
        .filter(
          (m) =>
            !normalizedQuery ||
            [m.id, m.displayName, m.description, m.category].some((value) =>
              value.toLowerCase().includes(normalizedQuery)
            )
        )
        .map((m) => ({
          type: m.id,
          displayName: m.displayName,
          description: m.description,
          category: m.category,
          ...(m.triggerType ? { isTrigger: true } : {}),
          authorable: m.agent?.authorable === true,
        }))
        .sort((a, b) => a.type.localeCompare(b.type))
      if (types.length === 0) {
        const filter = [
          ...(query ? [`query "${query}"`] : []),
          ...(category ? [`category "${category}"`] : []),
        ].join(' and ')
        return {
          success: false,
          output: null,
          error: `No node types match ${filter || 'the supplied filters'}. Call list_node_types without filters to see the full catalog.`,
        }
      }
      return { success: true, output: { types } }
    },
  }
}
