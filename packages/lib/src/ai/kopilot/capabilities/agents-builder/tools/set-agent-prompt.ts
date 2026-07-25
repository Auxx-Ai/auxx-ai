// packages/lib/src/ai/kopilot/capabilities/agents-builder/tools/set-agent-prompt.ts

import { updateAgent } from '../../../../../agents/agent-service'
import { mdToBlocks } from '../../../../../kb/markdown'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { resolveAgentAuthoring } from './agent-authoring-guard'
import { validateSchemaReferences } from './schema-references'

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
    permission: {
      target: 'area',
      area: 'agents',
      level: 'full',
      enforcement: 'enforced',
      note: 'resolveAgentAuthoring — PermissionKey.agentsManage (the agents area’s only rung) on the caller’s own CapabilitySet, plus an org-scope check on the session agent ref. Enforcement is proven behaviourally by agents-builder/tools/__tests__/agent-authoring-guard.test.ts.',
    },
    displayName: 'Set agent prompt',
    // Builder-only meta-tool — configures another agent. Never offered on a
    // chat/internal/email agent. See plans/chat/v6/chat-tool-availability.md.
    surfaces: ['builder'],
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
  - \`@[entity:<entityDef>]\` — the entity *type* (e.g. \`@[entity:ticket]\`).
    Use in the Capabilities & Scope sentence instead of writing the entity name
    inline. Validated server-side; unknown entityDefs are rejected.
  - \`@[field:<entityDef>:<fieldId>]\` — a field on an entity (e.g.
    \`@[field:ticket:status]\`). Use whenever the prompt classifies, tags,
    routes, or branches by a record value. Validated server-side; unknown
    fields are rejected.
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
            'Full persona prompt as markdown. Headings, paragraphs, lists, blockquotes, code fences, and inline `@[<id>]` references (`tool:`, `entity:`, `field:`, `article:`, `agent:`, `user:`, or a raw `<defId>:<instId>` record id) are supported. Replaces the previous prompt wholesale.',
          minLength: 1,
          maxLength: MARKDOWN_MAX_BYTES,
        },
      },
      required: ['markdown'],
      additionalProperties: false,
    },
    execute: async (args, agentDeps) => {
      const auth = await resolveAgentAuthoring(getDeps, agentDeps)
      if (!auth.ok) return { success: false, output: null, error: auth.error }
      const { agentId } = auth

      const markdown = typeof args.markdown === 'string' ? args.markdown : ''
      if (!markdown.trim()) {
        // Most common cause: max_tokens truncated the streamed tool_use input
        // mid-JSON, parseToolArgs returned `{}`, and we landed here with no
        // markdown. The runtime default is now 32K but very long personas can
        // still hit the cap — point the model at the most likely fix.
        const isEmpty = Object.keys(args).length === 0
        return {
          success: false,
          output: null,
          error: isEmpty
            ? 'No `markdown` argument received — the tool_use input was empty. This usually means the previous turn was truncated. Retry with a shorter prompt, fewer parallel tool calls, or break the prompt into sections.'
            : 'markdown must be a non-empty string. Pass the full persona prompt as markdown.',
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

      // Validate schema chips (`entity:` / `field:`) BEFORE persisting so the
      // model sees the failure in the next turn instead of saving a broken
      // prompt the admin can't run. Tools chips are validated by the toolset
      // reconciler — separate path.
      const validation = await validateSchemaReferences(doc, agentDeps.organizationId)
      if (validation.unresolvedReferences.length > 0) {
        return {
          success: false,
          output: {
            unresolvedReferences: validation.unresolvedReferences,
            warnings: validation.warnings,
          },
          error: validation.errorMessage,
        }
      }

      await updateAgent(agentId, agentDeps.organizationId, { prompt: doc })

      const referenceCount = countReferences(doc)
      const byteLength = JSON.stringify(doc).length

      return {
        success: true,
        output: {
          agentId,
          byteLength,
          referenceCount,
          warnings: validation.warnings,
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
