// packages/lib/src/ai/kopilot/agents/planner.ts

import { createScopedLogger } from '@auxx/logger'
import type {
  AgentDefinition,
  AgentDeps,
  AgentState,
  AgentToolDefinition,
} from '../../agent-framework/types'
import type { Message } from '../../clients/base/types'
import { buildPlannerSystemPrompt } from '../prompts/planner-prompt'
import type { KopilotDomainState, PlanStep } from '../types'

const logger = createScopedLogger('kopilot-planner')

const PLANNER_RESPONSE_SCHEMA = {
  name: 'execution_plan',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            description: { type: 'string' },
            tool: { type: 'string' },
          },
          required: ['id', 'description'],
          additionalProperties: false,
        },
      },
    },
    required: ['steps'],
    additionalProperties: false,
  },
}

/**
 * Create the planner agent.
 * Takes available tools so it can reference them in the prompt.
 */
export function createPlannerAgent(
  availableTools: AgentToolDefinition[]
): AgentDefinition<KopilotDomainState> {
  return {
    name: 'planner',

    buildMessages(state: AgentState<KopilotDomainState>, _deps: AgentDeps): Message[] {
      const systemPrompt = buildPlannerSystemPrompt(state.domainState, availableTools)

      // Include conversation context — the user's request and any prior assistant messages
      const conversationMessages: Message[] = state.messages
        .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content)
        .slice(-4)
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

      return [{ role: 'system', content: systemPrompt }, ...conversationMessages]
    },

    tools: [], // Planner is one-shot with structured output

    async processResult(
      content: string,
      _toolCalls,
      state: AgentState<KopilotDomainState>,
      _deps: AgentDeps
    ): Promise<AgentState<KopilotDomainState>> {
      let steps: PlanStep[] = []
      try {
        const parsed = JSON.parse(content)
        steps = (parsed.steps ?? []).map(
          (s: { id: string; description: string; tool?: string }) => ({
            id: s.id,
            description: s.description,
            tool: s.tool,
            status: 'pending' as const,
          })
        )
      } catch {
        logger.warn('Failed to parse planner output, using fallback step')
        // If parsing fails, create a single fallback step
        steps = [
          {
            id: '1',
            description: 'Execute the user request directly',
            status: 'pending',
          },
        ]
      }

      logger.info('Plan generated', {
        stepCount: steps.length,
        steps: steps.map((s) => ({ id: s.id, description: s.description, tool: s.tool })),
      })

      return {
        ...state,
        domainState: {
          ...state.domainState,
          plan: steps,
          currentPlanStepIndex: 0,
        },
      }
    },

    parameters: { temperature: 0 },
    responseFormat: { type: 'json_schema', jsonSchema: PLANNER_RESPONSE_SCHEMA },
  }
}
