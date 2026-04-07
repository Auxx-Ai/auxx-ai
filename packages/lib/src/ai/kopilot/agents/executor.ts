// packages/lib/src/ai/kopilot/agents/executor.ts

import { createScopedLogger } from '@auxx/logger'
import { getCachedResources } from '../../../cache/org-cache-helpers'
import type {
  AgentDefinition,
  AgentDeps,
  AgentState,
  AgentToolDefinition,
} from '../../agent-framework/types'
import type { Message, ToolCall } from '../../clients/base/types'
import { buildExecutorSystemPrompt } from '../prompts/executor-prompt'
import type { KopilotDomainState } from '../types'

const logger = createScopedLogger('kopilot-executor')

/**
 * Create the executor agent.
 * The executor is the tool-using agentic loop — it calls tools and processes results.
 */
export function createExecutorAgent(
  tools: AgentToolDefinition[]
): AgentDefinition<KopilotDomainState> {
  return {
    name: 'executor',

    async buildMessages(
      state: AgentState<KopilotDomainState>,
      deps: AgentDeps
    ): Promise<Message[]> {
      const resources = await getCachedResources(deps.organizationId)
      const entityCatalog = resources
        .filter((r) => r.isVisible !== false)
        .map((r) => ({
          apiSlug: r.apiSlug,
          label: r.label,
          plural: r.plural,
          entityDefinitionId: r.entityDefinitionId ?? r.id,
        }))

      const systemPrompt = buildExecutorSystemPrompt(state.domainState, entityCatalog)

      // Include full conversation (user, assistant, tool messages) for tool loop continuity
      const rawMessages: Message[] = state.messages
        .filter((m) => m.role !== 'system')
        .map((m) => {
          const msg: Message = {
            role: m.role as 'user' | 'assistant' | 'tool',
            content:
              m.role === 'assistant' && m.toolCalls?.length ? m.content || null : m.content || '',
            tool_call_id: m.toolCallId,
          }
          // Include tool_calls on assistant messages so subsequent tool results are valid
          if (m.role === 'assistant' && m.toolCalls?.length) {
            msg.tool_calls = m.toolCalls.map((tc) => ({
              id: tc.id,
              type: 'function' as const,
              function: { name: tc.function.name, arguments: tc.function.arguments },
            }))
          }
          return msg
        })

      // Sanitize: OpenAI requires every 'tool' message to follow an assistant
      // message with a matching tool_calls entry. Drop orphaned tool messages.
      const validToolCallIds = new Set<string>()
      const conversationMessages: Message[] = []
      for (const msg of rawMessages) {
        if (msg.role === 'assistant' && msg.tool_calls?.length) {
          for (const tc of msg.tool_calls) validToolCallIds.add(tc.id)
        }
        if (msg.role === 'tool') {
          if (!msg.tool_call_id || !validToolCallIds.has(msg.tool_call_id)) {
            logger.debug('Dropping orphaned tool message', { toolCallId: msg.tool_call_id })
            continue
          }
        }
        conversationMessages.push(msg)
      }

      return [{ role: 'system', content: systemPrompt }, ...conversationMessages]
    },

    tools,

    async processResult(
      content: string,
      toolCalls: ToolCall[],
      state: AgentState<KopilotDomainState>,
      _deps: AgentDeps
    ): Promise<AgentState<KopilotDomainState>> {
      const domainState = { ...state.domainState }

      // Track tool results for the responder — extract actual outputs from tool messages in state
      if (toolCalls.length > 0) {
        const toolCallIds = new Set(toolCalls.map((tc) => tc.id))
        const toolResultMsgs = state.messages.filter(
          (m) => m.role === 'tool' && m.toolCallId && toolCallIds.has(m.toolCallId)
        )
        const newResults = toolCalls.map((tc) => {
          const resultMsg = toolResultMsgs.find((m) => m.toolCallId === tc.id)
          let result: unknown = resultMsg?.content
          // Parse JSON string results back to objects for the responder prompt
          if (typeof result === 'string') {
            try {
              result = JSON.parse(result)
            } catch {
              /* keep as string */
            }
          }
          return { tool: tc.function.name, result }
        })
        domainState.toolResults = [...(domainState.toolResults ?? []), ...newResults]
      }

      // Advance plan step if we have a plan
      if (domainState.plan && domainState.currentPlanStepIndex != null) {
        const currentStep = domainState.plan[domainState.currentPlanStepIndex]
        if (currentStep) {
          currentStep.status = 'completed'
          currentStep.result = content
          domainState.currentPlanStepIndex = domainState.currentPlanStepIndex + 1
          logger.info('Plan step completed', {
            stepId: currentStep.id,
            stepDescription: currentStep.description,
            nextStepIndex: domainState.currentPlanStepIndex,
          })
        }
      }

      // Persist the final assistant message — only on one-shot exit (no tool calls).
      // When toolCalls exist, the query loop already appended an assistant message with the same content.
      const messages = [...state.messages]
      if (content && toolCalls.length === 0) {
        messages.push({
          role: 'assistant',
          content,
          timestamp: Date.now(),
          metadata: { agent: 'executor' },
        })
      }

      return { ...state, messages, domainState }
    },

    maxIterations: 15,
    minToolCalls: 1,
  }
}
