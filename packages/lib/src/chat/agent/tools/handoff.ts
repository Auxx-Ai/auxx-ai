// packages/lib/src/chat/agent/tools/handoff.ts

import type { AgentToolDefinition } from '../../../ai/agent-framework/types'
import { flipHandoffState } from '../handoff'

/**
 * `chat_handoff` — the escalation mechanism (plans/chat/v5 escalation.md §1).
 * A chat-safe tool the agent calls to hand the conversation to a human: it
 * flips `Thread.handoffState` to `'human'`, after which the phase-3 gate stops
 * firing the agent and the thread sits in the human queue until a teammate
 * replies or hands it back to `'ai'`.
 *
 * The "when" is authored in the agent persona prompt (v5 dropped structured
 * guidelines); the chat-kind templates seed escalation guidance as prose.
 *
 * No identity requirement — escalation works for anonymous visitors. The
 * `reason` is the agent's own free-text rationale (not a visitor-supplied
 * identifier, so it doesn't bypass the decision-6 scope clamp); it's recorded
 * on the tool call for inbox/audit context.
 */
export function createChatHandoffTool(): AgentToolDefinition {
  return {
    name: 'chat_handoff',
    displayName: 'Hand off to a teammate',
    toolsetSlug: 'auxx:chat',
    chatSafe: true,
    description:
      'Hand the conversation to a human teammate. Call this when you cannot ' +
      'help, when the visitor explicitly asks for a human, or when an ' +
      'escalation guideline in your instructions applies. After calling, tell ' +
      'the visitor a teammate will follow up — then stop; a human takes over.',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'A short rationale for the handoff (for the teammate picking this up).',
        },
      },
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      // Only meaningful inside a visitor chat run — `ctx.invocation` carries the
      // thread to escalate. Internal/kopilot runs have no thread to hand off.
      if (!ctx.invocation) {
        return {
          success: false,
          output: {},
          error: 'chat_handoff is only available in a chat conversation.',
        }
      }
      const reason = typeof args.reason === 'string' ? args.reason : undefined
      await flipHandoffState(
        { threadId: ctx.invocation.threadId, organizationId: ctx.organizationId },
        ctx.db
      )
      return { success: true, output: { handedOff: true, reason } }
    },
  }
}
