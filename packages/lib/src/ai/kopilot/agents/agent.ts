// packages/lib/src/ai/kopilot/agents/agent.ts

import { createScopedLogger } from '@auxx/logger'
import { toActorId } from '@auxx/types/actor'
import { getCachedIntegrationCatalog } from '../../../cache/integration-catalog'
import { getCachedMembersByUserIds, getCachedResources } from '../../../cache/org-cache-helpers'
import type {
  AgentDefinition,
  AgentDeps,
  AgentState,
  AgentToolDefinition,
} from '../../agent-framework/types'
import type { Message, ToolCall } from '../../clients/base/types'
import { transformAssistantContentForLLM } from '../blocks/transform-for-llm'
import { createSubmitFinalAnswerTool } from '../meta-tools/submit-final-answer'
import { buildAgentSystemPrompt, type CurrentUserInfo } from '../prompts/agent-prompt'
import type { KopilotDomainState } from '../types'

const logger = createScopedLogger('kopilot-agent')

export interface CreateKopilotAgentOptions {
  /** Business tools scoped to the current page (from CapabilityRegistry.getTools) */
  tools: AgentToolDefinition[]
  /** Human-friendly capability descriptions surfaced on request */
  capabilities?: string[]
  /** Max tool-use iterations before forcing a stop (default: 15) */
  maxIterations?: number
}

/**
 * Create the solo Kopilot agent.
 *
 * Owns the full turn: calls tools (which emit their own `auxx:*` blocks via
 * tool results), loops on tool results, and finally calls `submit_final_answer`
 * to terminate with a prose wrap-up.
 */
export function createKopilotAgent(
  options: CreateKopilotAgentOptions
): AgentDefinition<KopilotDomainState> {
  const { tools, capabilities = [], maxIterations = 15 } = options

  // Append the terminator meta-tool. Dedupe if someone already added it.
  const submitFinalAnswer = createSubmitFinalAnswerTool()
  const agentTools: AgentToolDefinition[] = tools.some((t) => t.name === submitFinalAnswer.name)
    ? tools
    : [...tools, submitFinalAnswer]

  return {
    name: 'agent',

    async buildMessages(
      state: AgentState<KopilotDomainState>,
      deps: AgentDeps
    ): Promise<Message[]> {
      const [resources, currentUser, integrations] = await Promise.all([
        getCachedResources(deps.organizationId),
        hydrateCurrentUser(deps.organizationId, deps.userId),
        getCachedIntegrationCatalog(deps.organizationId),
      ])

      const entityCatalog = resources
        .filter((r) => r.isVisible !== false)
        .map((r) => ({
          apiSlug: r.apiSlug,
          label: r.label,
          plural: r.plural,
          entityDefinitionId: r.entityDefinitionId ?? r.id,
        }))

      const systemPrompt = buildAgentSystemPrompt(
        state.domainState,
        entityCatalog,
        capabilities,
        agentTools,
        currentUser,
        integrations
      )

      // Full conversation for tool-loop continuity.
      // Final-prose assistant messages run through transformAssistantContentForLLM
      // so `auxx:*` reference fences become numbered text the model can index by
      // ordinal (e.g. "delete the second one"). Persisted content is unchanged —
      // this is a per-call view transform.
      const rawMessages: Message[] = state.messages
        .filter((m) => m.role !== 'system')
        .map((m) => {
          const isAssistantWithTools = m.role === 'assistant' && m.toolCalls?.length
          const isAssistantFinal = m.role === 'assistant' && !m.toolCalls?.length
          const content = isAssistantWithTools
            ? m.content || null
            : isAssistantFinal
              ? transformAssistantContentForLLM(m.content || '')
              : m.content || ''
          const msg: Message = {
            role: m.role as 'user' | 'assistant' | 'tool',
            content,
            tool_call_id: m.toolCallId,
            reasoning_content: m.reasoning_content,
          }
          if (m.role === 'assistant' && m.toolCalls?.length) {
            msg.tool_calls = m.toolCalls.map((tc) => ({
              id: tc.id,
              type: 'function' as const,
              function: { name: tc.function.name, arguments: tc.function.arguments },
            }))
          }
          return msg
        })

      return [{ role: 'system', content: systemPrompt }, ...rawMessages]
    },

    tools: agentTools,

    async processResult(
      _content: string,
      _toolCalls: ToolCall[],
      state: AgentState<KopilotDomainState>,
      _deps: AgentDeps
    ): Promise<AgentState<KopilotDomainState>> {
      // The query loop owns message persistence and block rendering. processResult
      // is just an identity here — no per-turn transient state to maintain.
      return state
    },

    maxIterations,
  }
}

async function hydrateCurrentUser(
  organizationId: string,
  userId: string
): Promise<CurrentUserInfo | null> {
  try {
    const [member] = await getCachedMembersByUserIds(organizationId, [userId])
    if (!member) {
      logger.debug('Current user not found in org members cache', { organizationId, userId })
      return null
    }
    return {
      userId,
      actorId: toActorId('user', userId),
      name: member.user?.name ?? null,
      email: member.user?.email ?? null,
      role: member.role,
    }
  } catch (err) {
    logger.warn('Failed to hydrate current user for Kopilot prompt', {
      organizationId,
      userId,
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}
