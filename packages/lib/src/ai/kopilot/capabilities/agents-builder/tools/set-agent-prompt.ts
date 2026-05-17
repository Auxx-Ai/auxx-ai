// packages/lib/src/ai/kopilot/capabilities/agents-builder/tools/set-agent-prompt.ts

import { updateAgent } from '../../../../../agents/agent-service'
import { mdToBlocks } from '../../../../../kb/markdown'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { findRef } from '../../../context-refs'
import type { GetToolDeps } from '../../types'
import { buildAgentRailUpdate } from '../snapshot'

const MARKDOWN_MAX_BYTES = 20_000

/**
 * Replace the persona prompt of the agent bound to this builder session.
 *
 * The model authors markdown; the server expands it into the editor's block
 * shape (`mdToBlocks`) — same converter the KB write tools use. Wholesale
 * replace; to edit, fetch the current prompt from the active references,
 * splice locally, send the full markdown back.
 */
export function createSetAgentPromptTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'set_agent_prompt',
    displayName: 'Set agent prompt',
    description: `Replace the agent's persona prompt with a markdown document.

The persona prompt is the agent's instructions: tone, role, constraints,
escalation rules, and any \`@\`-references to tools / KB articles / people /
records that seed its knowledge scope. The doc is shown to admins in the
Prompt tab.

Use standard markdown — headings, paragraphs, bullet / numbered lists,
blockquotes, code fences, dividers. Inline \`@[<id>]\` syntax embeds a
reference chip. Supported ids:
  - \`@[tool:<name>]\` — a specific tool (e.g. \`@[tool:reply_to_thread]\`).
    Use these EAGERLY — referencing a tool by name in the prompt makes the
    chip render in the editor, and the runtime expands it to a backtick-quoted
    tool name when this agent runs.
  - \`@[article:<recordId>]\` — KB article.
  - \`@[agent:<agentId>]\` — another agent in this workspace.
  - \`@[user:<userId>]\` — a workspace teammate (not the agent itself).
  - \`@[<defId>:<instId>]\` — any CRM record by its colon-joined recordId.

The previous prompt is replaced wholesale.`,
    parameters: {
      type: 'object',
      properties: {
        markdown: {
          type: 'string',
          description:
            'Full persona prompt as markdown. Headings, paragraphs, lists, blockquotes, code fences, and inline `@[<id>]` references (`tool:`, `article:`, `agent:`, `user:`, or a raw `<defId>:<instId>` record id) are supported. Replaces the previous prompt wholesale.',
          minLength: 1,
          maxLength: MARKDOWN_MAX_BYTES,
        },
      },
      required: ['markdown'],
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

      const markdown = typeof args.markdown === 'string' ? args.markdown : ''
      if (!markdown.trim()) {
        return {
          success: false,
          output: null,
          error: 'markdown must be a non-empty string. Pass the full persona prompt as markdown.',
        }
      }
      if (markdown.length > MARKDOWN_MAX_BYTES) {
        return {
          success: false,
          output: null,
          error: `markdown exceeds max ${MARKDOWN_MAX_BYTES} characters (got ${markdown.length})`,
        }
      }

      let blocks: ReturnType<typeof mdToBlocks>
      try {
        blocks = mdToBlocks(markdown)
      } catch (err) {
        return {
          success: false,
          output: null,
          error: `Failed to parse markdown: ${err instanceof Error ? err.message : String(err)}`,
        }
      }

      const doc = { type: 'doc', content: blocks } as Record<string, unknown>
      await updateAgent(agentRef.id, agentDeps.organizationId, { prompt: doc })

      const referenceCount = countReferences(doc)
      const byteLength = JSON.stringify(doc).length

      return {
        success: true,
        output: {
          agentId: agentRef.id,
          byteLength,
          referenceCount,
          ...buildAgentRailUpdate({
            agentId: agentRef.id,
            changed: ['prompt'],
            summary: `prompt replaced (${byteLength} bytes, ${referenceCount} refs)`,
          }),
        },
      }
    },
  }
}

/**
 * Walk the doc and count `reference` inline nodes (the `@[id]` chips). The
 * exact reference → scope reconciliation lives in the prompt-mentions plan.
 */
function countReferences(doc: Record<string, unknown>): number {
  let count = 0
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    const n = node as { type?: string; content?: unknown[] }
    if (n.type === 'reference') count++
    if (Array.isArray(n.content)) {
      for (const child of n.content) walk(child)
    }
  }
  walk(doc)
  return count
}
