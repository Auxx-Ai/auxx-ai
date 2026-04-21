// packages/lib/src/ai/kopilot/meta-tools/submit-final-answer.ts

import type { AgentToolDefinition, AgentToolResult } from '../../agent-framework/types'

/**
 * The terminator tool for a Kopilot turn.
 *
 * The solo agent is expected to call this exactly once at the end of its turn,
 * passing a short prose wrap-up as `content`. The query loop detects the
 * `__terminate` marker on the output and emits a `final-message` SSE event.
 *
 * Rich data (records, drafts, tables) is already rendered as `auxx:*` blocks
 * attached to prior tool results — this content must be prose only.
 */
export function createSubmitFinalAnswerTool(): AgentToolDefinition {
  return {
    name: 'submit_final_answer',
    description:
      'Send your final message to the user. Exactly once, at the end of the turn. Content is prose plus any `auxx:*` fences that the tool guidance told you to emit. Copy IDs verbatim from tool results — never invent them.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        content: {
          type: 'string',
          description:
            'Prose shown to the user plus any `auxx:*` fenced blocks. Markdown supported. IDs inside blocks must come from tool results.',
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
