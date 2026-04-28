// packages/lib/src/ai/kopilot/meta-tools/submit-final-answer.ts

import type { AgentToolDefinition, AgentToolResult } from '../../agent-framework/types'

/**
 * The terminator tool for a Kopilot turn.
 *
 * The solo agent is expected to call this exactly once at the end of its turn,
 * passing prose plus any `auxx:*` reference-block fences as `content`. The
 * query loop detects the `__terminate` marker on the output and emits a
 * `final-message` SSE event.
 *
 * The LLM controls UI rendering: if a record/thread/task should appear in
 * the chat, it must be embedded as a fence in `content`. Prose-only mentions
 * render as text only — the user sees no card/list/table.
 */
export function createSubmitFinalAnswerTool(): AgentToolDefinition {
  return {
    name: 'submit_final_answer',
    description: `Send your final message to the user. Exactly once, at the end of the turn.

\`content\` is prose plus any \`auxx:*\` fences. Markdown supported. IDs inside fences must be copied verbatim from tool results — never invent them.

REQUIRED: If \`search_entities\`, \`query_records\`, \`get_entity\`, \`find_threads\`, \`get_thread_detail\`, or \`list_tasks\` returned records/threads/tasks and you are mentioning any of them by name in \`content\`, those items MUST appear in the matching \`auxx:*\` fence:
- 1 record → \`auxx:entity-card\`
- 2+ records → \`auxx:entity-list\`
- 1+ threads → \`auxx:thread-list\`
- 1+ tasks → \`auxx:task-list\`

Only include the items you are actually discussing. If a search returned 3 results but you're only referring to 1 of them, the fence contains 1 — not all 3. If you're not discussing any of them in this response, no fence needed.

Prose-only references to records that exist in tool results are a bug — the user won't see them.`,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        content: {
          type: 'string',
          description:
            'Prose shown to the user plus any `auxx:*` fenced blocks. Markdown supported. IDs inside blocks must come from tool results. Records/threads/tasks you mention by name MUST be embedded as fences (see tool description).',
        },
      },
      required: ['content'],
    },
    async execute(args): Promise<AgentToolResult> {
      const content = typeof args.content === 'string' ? args.content : ''
      return {
        success: true,
        output: { __terminate: true, content },
      }
    },
  }
}
