// packages/lib/src/ai/kopilot/capabilities/agents-builder/tools/set-agent-prompt.ts

import { updateAgent } from '../../../../../agents/agent-service'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { findRef } from '../../../context-refs'
import type { GetToolDeps } from '../../types'
import { buildAgentRailUpdate } from '../snapshot'

const PROMPT_MAX_BYTES = 64_000

/**
 * Replace the persona prompt document of the agent bound to this builder
 * session. The `doc` argument is a TiptapJSON document — the same shape the
 * Prompt-tab editor writes. Append-style edits are computed client-side by
 * the model and submitted as a full new doc.
 */
export function createSetAgentPromptTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'set_agent_prompt',
    description: `Replace the agent's persona prompt with a new TiptapJSON document.

The persona prompt is the agent's instructions: tone, role, constraints,
escalation rules, and any \`@\`-mentions of toolsets / records / KBs that
seed its knowledge scope. The doc is shown to admins in the Prompt tab.

To append a section, fetch the current doc (it lives in this session's
active references / agent detail), splice on a new heading + paragraph
yourself, and pass the FULL resulting document.`,
    parameters: {
      type: 'object',
      properties: {
        doc: {
          type: 'object',
          description:
            'Full TiptapJSON document — `{ type: "doc", content: [...] }`. The previous prompt is replaced wholesale.',
          additionalProperties: true,
        },
      },
      required: ['doc'],
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

      const doc = args.doc as Record<string, unknown> | undefined
      if (!doc || typeof doc !== 'object') {
        return { success: false, output: null, error: 'doc must be a TiptapJSON object' }
      }
      if (doc.type !== 'doc' || !Array.isArray((doc as { content?: unknown }).content)) {
        return {
          success: false,
          output: null,
          error: 'doc must be a TiptapJSON document with `type: "doc"` and a `content` array',
        }
      }

      const serialized = JSON.stringify(doc)
      if (serialized.length > PROMPT_MAX_BYTES) {
        return {
          success: false,
          output: null,
          error: `prompt exceeds max ${PROMPT_MAX_BYTES} bytes (got ${serialized.length})`,
        }
      }

      await updateAgent(agentRef.id, agentDeps.organizationId, { prompt: doc })

      const referenceCount = countReferences(doc)

      return {
        success: true,
        output: {
          agentId: agentRef.id,
          byteLength: serialized.length,
          referenceCount,
          ...buildAgentRailUpdate({
            agentId: agentRef.id,
            changed: ['prompt'],
            summary: `prompt replaced (${serialized.length} bytes, ${referenceCount} refs)`,
          }),
        },
      }
    },
  }
}

/**
 * Walk the doc and count `@`-mention reference nodes. Mention chips are
 * Tiptap inline nodes with `type: 'reference'` (or similar — the parser
 * tolerates a couple of variants used in the codebase). The exact mention
 * → scope reconciliation lives in the prompt-mentions plan.
 */
function countReferences(doc: Record<string, unknown>): number {
  let count = 0
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    const n = node as { type?: string; content?: unknown[] }
    if (n.type === 'reference' || n.type === 'mention') count++
    if (Array.isArray(n.content)) {
      for (const child of n.content) walk(child)
    }
  }
  walk(doc)
  return count
}
