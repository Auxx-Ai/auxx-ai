// packages/lib/src/ai/kopilot/agents/responder.ts

import type { AgentDefinition, AgentDeps, AgentState } from '../../agent-framework/types'
import type { Message } from '../../clients/base/types'
import { buildResponderSystemPrompt } from '../prompts/responder-prompt'
import type { KopilotDomainState } from '../types'

/**
 * Create the responder agent.
 * Synthesizes tool results and conversation context into a final user-facing message.
 */
export function createResponderAgent(): AgentDefinition<KopilotDomainState> {
  return {
    name: 'responder',

    buildMessages(state: AgentState<KopilotDomainState>, _deps: AgentDeps): Message[] {
      const systemPrompt = buildResponderSystemPrompt(state.domainState)

      // Include the full conversation for synthesis context
      const conversationMessages: Message[] = state.messages
        .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content)
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

      return [{ role: 'system', content: systemPrompt }, ...conversationMessages]
    },

    tools: [], // Responder is one-shot, no tools

    async processResult(
      content: string,
      _toolCalls,
      state: AgentState<KopilotDomainState>,
      _deps: AgentDeps
    ): Promise<AgentState<KopilotDomainState>> {
      // Append the final response as an assistant message
      const messages = [
        ...state.messages,
        {
          role: 'assistant' as const,
          content,
          timestamp: Date.now(),
          metadata: { agent: 'responder' },
        },
      ]

      // Clear transient tool results now that they've been synthesized
      return {
        ...state,
        messages,
        domainState: {
          ...state.domainState,
          toolResults: undefined,
          plan: undefined,
          currentPlanStepIndex: undefined,
          classification: undefined,
        },
      }
    },
  }
}
