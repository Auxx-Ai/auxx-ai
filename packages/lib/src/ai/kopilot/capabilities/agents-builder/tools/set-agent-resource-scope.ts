// packages/lib/src/ai/kopilot/capabilities/agents-builder/tools/set-agent-resource-scope.ts

import {
  type AgentScopeMode,
  batchSetAgentResourceScopes,
} from '../../../../../agents/agent-scope-service'
import { isKnowledgeScopeRecordId } from '../../../../../agents/knowledge-scope'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { resolveAgentAuthoring } from './agent-authoring-guard'

const MAX_SCOPES = 200
const VALID_MODES: AgentScopeMode[] = ['include_descendants', 'include_one', 'exclude']
const RECORD_ID_MIN = 1
const RECORD_ID_MAX = 180

/**
 * Narrow (or widen) which knowledge bases, articles and datasets the agent
 * searches by default — its **retrieval scope**, not an access-control list.
 * Pass the full desired set; rows in the DB that aren't in `scopes` are
 * deleted (unless they're mention-sourced, which the prompt reconciler owns).
 *
 * Permissions (who/what the agent may read) are configured separately — this
 * tool only shapes what `search_knowledge` and the Knowledge Catalog look at.
 */
export function createSetAgentResourceScopeTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'set_agent_resource_scope',
    permission: {
      target: 'area',
      area: 'agents',
      level: 'full',
      enforcement: 'enforced',
      note: 'resolveAgentAuthoring — PermissionKey.agentsManage (the agents area’s only rung) on the caller’s own CapabilitySet, plus an org-scope check on the session agent ref. Enforcement is proven behaviourally by agents-builder/tools/__tests__/agent-authoring-guard.test.ts.',
    },
    displayName: 'Set agent resource scope',
    // Builder-only meta-tool. See plans/chat/v6/chat-tool-availability.md.
    surfaces: ['builder'],
    description: `Narrow which knowledge sources the agent searches by default (its retrieval scope) —
for example "focus this agent on the Returns KB" or "exclude the internal-only dataset".

This is NOT an access-control mechanism — permissions (who/what the agent may
read) are configured separately. An empty scope means the agent searches all
org knowledge; scoping only narrows the default search set.

Pass the FULL desired set of scopes. Rows in the DB that aren't in this list
are removed (mention-pinned rows are preserved).

Each row:
- recordId targets a knowledge source: \`kb:<id>\` (one knowledge base),
  \`article:<id>\` (one article), \`dataset:<id>\` (one RAG dataset), or the
  bare definition-level \`kb\` / \`dataset\` (covers every KB / dataset in the
  org). Bare \`article\` is not valid — articles are always instance-level.
- mode: include_descendants | include_one | exclude

Search for source names first with \`search_knowledge\` before guessing
recordIds.`,
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
                description:
                  'Knowledge source id: `kb:<id>`, `article:<id>`, `dataset:<id>`, or bare `kb`/`dataset` for definition-level',
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
      const auth = await resolveAgentAuthoring(getDeps, agentDeps)
      if (!auth.ok) return { success: false, output: null, error: auth.error }
      const { agentId } = auth

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
        if (!isKnowledgeScopeRecordId(row.recordId)) {
          return {
            success: false,
            output: null,
            error: `recordId "${row.recordId}" must target a knowledge source: \`kb:<id>\`, \`article:<id>\`, \`dataset:<id>\`, or bare \`kb\`/\`dataset\`.`,
          }
        }
      }

      const { applied } = await batchSetAgentResourceScopes(
        agentDeps.organizationId,
        agentId,
        scopes
      )

      return {
        success: true,
        output: {
          agentId,
          scopesApplied: applied,
        },
      }
    },
  }
}
