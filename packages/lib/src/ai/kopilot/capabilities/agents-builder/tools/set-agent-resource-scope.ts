// packages/lib/src/ai/kopilot/capabilities/agents-builder/tools/set-agent-resource-scope.ts

import {
  type AgentScopeMode,
  batchSetAgentResourceScopes,
} from '../../../../../agents/agent-scope-service'
import { findCachedResource } from '../../../../../cache/org-cache-helpers'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { findRef } from '../../../context-refs'
import type { GetToolDeps } from '../../types'

const MAX_SCOPES = 200
const VALID_MODES: AgentScopeMode[] = ['include_descendants', 'include_one', 'exclude']
const RECORD_ID_MIN = 1
const RECORD_ID_MAX = 180

/**
 * Replace the agent's resource-scope rows. Pass the full desired set; rows in
 * the DB that aren't in `scopes` are deleted (unless they're mention-sourced,
 * which the prompt reconciler owns).
 */
export function createSetAgentResourceScopeTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'set_agent_resource_scope',
    displayName: 'Set agent resource scope',
    description: `Update the agent's resource-scope rows (which records / entity types it can read).

Pass the FULL desired set of scopes. Rows in the DB that aren't in this list
are removed (mention-pinned rows are preserved).

Each row:
- recordId: \`<defId>:<instanceId>\` for one record, or just \`<defId>\` for
  a definition-level scope (covers every record of that type).
- mode: include_descendants | include_one | exclude

Search for record names first with \`search_entities\` / \`search_knowledge\`
before guessing recordIds.`,
    parameters: {
      type: 'object',
      properties: {
        scopes: {
          type: 'array',
          maxItems: MAX_SCOPES,
          items: {
            type: 'object',
            properties: {
              recordId: {
                type: 'string',
                minLength: RECORD_ID_MIN,
                maxLength: RECORD_ID_MAX,
                description: '`<defId>:<instanceId>` or `<defId>` for definition-level',
              },
              mode: { type: 'string', enum: VALID_MODES },
            },
            required: ['recordId', 'mode'],
            additionalProperties: false,
          },
        },
      },
      required: ['scopes'],
      additionalProperties: false,
    },
    execute: async (args, agentDeps) => {
      const { sessionContext } = getDeps()
      const agentRef = findRef(sessionContext, 'agent')
      if (!agentRef?.id) {
        return {
          success: false,
          output: null,
          error: 'No agent in session context — this tool only runs on the builder page.',
        }
      }

      const scopes = (args.scopes ?? []) as Array<{ recordId: string; mode: AgentScopeMode }>
      if (!Array.isArray(scopes)) {
        return { success: false, output: null, error: 'scopes must be an array' }
      }

      for (const row of scopes) {
        if (
          typeof row.recordId !== 'string' ||
          row.recordId.length < RECORD_ID_MIN ||
          row.recordId.length > RECORD_ID_MAX
        ) {
          return {
            success: false,
            output: null,
            error: `recordId must be a string of ${RECORD_ID_MIN}–${RECORD_ID_MAX} chars`,
          }
        }
        if (!VALID_MODES.includes(row.mode)) {
          return {
            success: false,
            output: null,
            error: `mode must be one of: ${VALID_MODES.join(', ')}`,
          }
        }
        const colon = row.recordId.indexOf(':')
        const entityDefinitionId = colon === -1 ? row.recordId : row.recordId.slice(0, colon)
        const def = await findCachedResource(agentDeps.organizationId, entityDefinitionId)
        if (!def) {
          return {
            success: false,
            output: null,
            error: `Unknown entityDefinitionId "${entityDefinitionId}" in recordId "${row.recordId}".`,
          }
        }
      }

      const { applied } = await batchSetAgentResourceScopes(
        agentDeps.organizationId,
        agentRef.id,
        scopes
      )

      return {
        success: true,
        output: {
          agentId: agentRef.id,
          scopesApplied: applied,
        },
      }
    },
  }
}
