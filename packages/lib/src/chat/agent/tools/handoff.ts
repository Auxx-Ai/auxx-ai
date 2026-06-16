// packages/lib/src/chat/agent/tools/handoff.ts

import { PROC_SIGNAL_KEY } from '../../../agents/procedures/control-tools'
import type { AgentToolDefinition } from '../../../ai/agent-framework/types'

/**
 * `handoff` — the single escalation tool (plans/chat/v10 handoff-unify.md). The
 * one tool a chat agent calls to hand the conversation to a human; it replaces
 * the old two-tool split (`chat_handoff` + the procedure-control `handoff_to_human`).
 *
 * It is **pure intent**: `execute()` records a `{kind:'handoff'}` signal into the
 * turn-local store ({@link PROC_SIGNAL_KEY}) and returns — it does NOT flip the
 * thread itself. Two consumers pick the intent up after the turn:
 *
 *   - **Procedure path:** the stepper's `interpretSignal` reads the signal and
 *     clears the procedure stack (frame teardown for free), reporting handoff up
 *     through `runProcedureTurn`.
 *   - **Any path:** the shared `drain` in the turn processor sees the `handoff`
 *     `tool-call-started` event (universal backstop — also covers a tool handoff
 *     on a free-form turn of a procedure agent, where `interpretSignal` never runs).
 *
 * Either way the post-turn applier calls `flipHandoffState` exactly once — the
 * sole flip + event site. Keeping the tool side-effect-free also lets simulations
 * detect handoff without mocking `flipHandoffState` (no DB write inside an eval).
 *
 * The "when" is authored in the agent persona prompt (v5 dropped structured
 * guidelines); the chat-kind templates seed escalation guidance as prose. No
 * identity requirement — escalation works for anonymous visitors. The `reason`
 * is the agent's free-text rationale, read off the tool-call args by the applier
 * and recorded for inbox/audit context.
 */
export function createHandoffTool(): AgentToolDefinition {
  return {
    name: 'handoff',
    displayName: 'Hand off to a teammate',
    toolsetSlug: 'auxx:chat',
    // The escalation path — only meaningful on a visitor chat turn, and safe for
    // an anonymous visitor (it just flags the thread for a human).
    surfaces: ['chat'],
    externalSafe: true,
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
      // Pure intent: record the signal and return. The post-turn applier flips
      // the thread (it has the threadId); the procedure stepper consumes the
      // same signal to tear down any active frame. No thread anchor needed —
      // the tool no longer touches the thread, so it works in evals too.
      const reason = typeof args.reason === 'string' ? args.reason : undefined
      await ctx.context.write(PROC_SIGNAL_KEY, { kind: 'handoff' })
      return { success: true, output: { handedOff: true, reason } }
    },
  }
}
