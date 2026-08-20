// packages/lib/src/ai/kopilot/capabilities/workflow-builder/tools/list-node-types.ts

import { listManifests } from '../../../../../workflow-engine/catalog/registry'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'

/**
 * Search key: lowercased, every non-alphanumeric run collapsed to one space.
 *
 * A plain substring match over the raw strings is why `"if else"` missed
 * `if-else` (hyphen) and `IF/ELSE` (slash) — the two spellings that ARE the
 * answer. Normalizing both sides makes punctuation irrelevant, and `synonyms`
 * covers the words that share no substring at all ("switch", "route").
 */
function searchNormalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

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
      'List or search workflow node types: id, display name, one-line description, category, whether it is a trigger, and whether you may author it. Call describe_node_type before configuring one. This is the CORE catalog only — blocks contributed by installed apps are addressed as "<appId>:<blockId>" and are listed by list_app_blocks, so an empty result here does not mean no such block exists.',
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
      const normalizedQuery = searchNormalize(query)
      const types = listManifests()
        .filter((m) => !category || m.category === category)
        .filter(
          (m) =>
            !normalizedQuery ||
            [m.id, m.displayName, m.description, m.category, ...(m.synonyms ?? [])].some((value) =>
              searchNormalize(value).includes(normalizedQuery)
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
        // `success: true`, deliberately. An empty result is a complete ANSWER,
        // not a failed call — and returning `success: false` made models read
        // it as a tool failure and reword: one logged turn burned four
        // iterations before finding `if-else` via the one-character query
        // "if" (plan 21 §3.3). Same fix plan 19 applied to `list_app_blocks`
        // after 33 reworded calls in a single turn. The note ends by saying
        // the answer is complete, because a note that only describes the world
        // leaves "maybe a different word finds it" open.
        return {
          success: true,
          output: {
            types: [],
            note:
              `No CORE node type matches ${filter || 'the supplied filters'}. This search covers ` +
              'every core type and their synonyms, so a reworded query will not change the ' +
              'answer — do not call this again with different words. Call list_node_types with ' +
              'no filters to see the whole catalog, or list_app_blocks for blocks contributed ' +
              'by installed apps, which are never in this list.',
          },
        }
      }
      return { success: true, output: { types } }
    },
  }
}
